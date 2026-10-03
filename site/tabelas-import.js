(function(root){
  'use strict';
  /* ===================================================================
     Importador administrativo da base ILIKIA pelo NAVEGADOR (sem Node, sem chave de servico).
     Usa a mesma sessao do Firebase ja logada. A autorizacao efetiva e das regras do Firestore:
     a criacao em ilikia_registros e a escrita em ilikia_meta/ilikia_import so sao aceitas para o admin.

     Garantias (revisao 2):
       - VERIFICA EXISTENCIA e cria SO o que falta, dentro de uma transacao (protecao contra gravacao
         concorrente). Nao confia apenas na regra versao+1: a propria importacao le o documento e so grava
         se estiver ausente. Documento online e preservado mesmo que o arquivo traga versao maior.
       - Controle por DOCUMENTO (nao por posicao no arquivo). Reordenar o arquivo nao pode causar registro
         omitido: cada registro e avaliado pela presenca no servidor, nao por um indice de progresso.
       - Retomada e recuperacao recalculadas a cada tentativa: pendencias = o que ainda falta agora.
         Se o mapa falhou e depois gravou, a falha deixa de constar.
       - Confirma a gravacao no servidor (transacao resolvida) antes de contabilizar.
       - Valida antes de gravar: projeto conectado, estrutura, ids/campos, contagem por modalidade e metadata.
       - A edicao normal autorizada (update com versao+1) continua funcionando; a importacao nunca faz update.
     Sem travessao. Sem armazenamento local.
  =================================================================== */
  const REG='ilikia_registros', META_COL='ilikia_meta', META_DOC='info', PROG_COL='ilikia_import', PROG_DOC='progress';
  const TARGET_PROJECT='efa-comercial';
  const SCAN_PAGE=500;  // leitura paginada dos ids existentes
  const TX_CHUNK=100;   // documentos por transacao (le todos e cria os ausentes)
  const DATASETS=['RODOVIARIO','AEREO_CONVENCIONAL','AEREO_EXPRESSO','CIDADES','PRAZOS'];

  // Hash de string (cyrb53): baixa colisao, sem dependencia.
  function cyrb53(str, seed){ let h1=0xdeadbeef^(seed||0), h2=0x41c6ce57^(seed||0);
    for(let i=0,ch;i<str.length;i++){ ch=str.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677); }
    h1=Math.imul(h1^(h1>>>16),2246822507); h1^=Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507); h2^=Math.imul(h1^(h1>>>13),3266489909);
    return (4294967296*(2097151&h2)+(h1>>>0)).toString(36); }
  // Serializacao estavel (chaves ordenadas) para a assinatura nao depender da ordem das chaves.
  function stableStringify(v){
    if(v===null||typeof v!=='object') return JSON.stringify(v);
    if(Array.isArray(v)) return '['+v.map(stableStringify).join(',')+']';
    const keys=Object.keys(v).sort();
    return '{'+keys.map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}';
  }
  // Assinatura do CONTEUDO RELEVANTE COMPLETO do arquivo (inclui valores/campos), independente da ordem
  // dos registros. Serve para IDENTIFICAR o arquivo (auditoria/retomada informativa); a importacao em si
  // nao depende dela para decidir o que gravar (isso vem da verificacao de existencia por documento).
  function signature(records){
    if(!Array.isArray(records)||!records.length) return null;
    const parts=new Array(records.length);
    for(let i=0;i<records.length;i++) parts[i]=cyrb53(stableStringify(records[i]));
    parts.sort();
    return records.length+':'+cyrb53(parts.join('|'));
  }

  function create(api,db,opts){
    opts=opts||{};
    const projectId=opts.projectId||(db&&db._projectId)||null;
    const target=opts.targetProject||TARGET_PROJECT;
    const dref=(col,id)=>api.doc(db,col,id);

    // ---- Validacao (NAO grava nada) ----
    function validate(json){
      const problems=[], warnings=[];
      const matchesTarget = projectId===target;
      if(!matchesTarget) warnings.push('Projeto conectado e "'+(projectId||'desconhecido')+'", nao "'+target+'". A importacao so roda conectada ao projeto '+target+'.');
      const isObj = json && typeof json==='object' && !Array.isArray(json);
      const records = isObj ? (json.records||json.registros) : (Array.isArray(json)?json:null);
      if(!Array.isArray(records) || !records.length){
        problems.push('Arquivo invalido: nao encontrei a lista de registros (campo "records").');
        return {ok:false, problems, warnings, counts:{}, total:0, metaPresent:false, metaMapUfs:0, projectId, matchesTarget, sig:null};
      }
      const counts={}; DATASETS.forEach(d=>counts[d]=0); let outros=0;
      const ids=new Set(); let dup=0, semId=0, versaoRuim=0, camposRuim=0, semDataset=0;
      for(let i=0;i<records.length;i++){
        const r=records[i]||{};
        if(typeof r.id!=='string' || !r.id){ semId++; }
        else { if(ids.has(r.id)) dup++; ids.add(r.id); }
        if(!Number.isInteger(r.versao)) versaoRuim++;
        if(!Array.isArray(r.campos)) camposRuim++;
        if(typeof r.dataset!=='string' || !r.dataset){ semDataset++; }
        else if(counts[r.dataset]!=null) counts[r.dataset]++; else outros++;
      }
      if(semId) problems.push(semId+' registro(s) sem id valido (nao da para gravar sem id).');
      if(dup) problems.push(dup+' id(s) repetido(s) no arquivo (gravaria menos registros do que o esperado).');
      if(versaoRuim) problems.push(versaoRuim+' registro(s) com "versao" que nao e numero inteiro (a regra exige inteiro).');
      if(camposRuim) problems.push(camposRuim+' registro(s) sem "campos" em lista (a regra exige lista).');
      if(semDataset) warnings.push(semDataset+' registro(s) sem "dataset" (entram, mas nao caem numa modalidade conhecida).');
      if(outros) warnings.push(outros+' registro(s) com dataset fora das 5 modalidades conhecidas.');
      const meta = isObj ? json.meta : null;
      const metaPresent = !!(meta && typeof meta==='object');
      const metaMapUfs = metaPresent && meta.mapa && meta.mapa.por_uf ? Object.keys(meta.mapa.por_uf).length : 0;
      if(!metaPresent) warnings.push('Sem bloco "meta": o mapa (ilikia_meta/info) nao sera gravado. Confira se e o arquivo certo (o de COMERCIAL nao tem meta.mapa; use o do _v2).');
      else if(!metaMapUfs) warnings.push('"meta" presente, mas sem mapa.por_uf: o mapa por UF ficaria indisponivel. Confira se e o arquivo certo (use o do _v2, com mapa das 27 UFs).');
      const ok = problems.length===0;
      return {ok, problems, warnings, counts, outros, total:records.length, metaPresent, metaMapUfs,
              idsUnicos:ids.size, projectId, matchesTarget, sig:signature(records)};
    }

    async function getProgress(){
      try{ const s=await api.getDoc(dref(PROG_COL,PROG_DOC)); return s.exists()?s.data():null; }catch(e){ return null; }
    }
    async function writeProgress(p){
      try{ await api.setDoc(dref(PROG_COL,PROG_DOC), Object.assign({updated_at:api.serverTimestamp()}, p)); }catch(e){ /* progresso e auxiliar; nao derruba o import */ }
    }
    function recordsOf(json){
      if(json && typeof json==='object' && !Array.isArray(json)) return json.records||json.registros||[];
      return Array.isArray(json)?json:[];
    }

    // Le todos os ids ja existentes na colecao (verificacao de existencia). Leitura paginada.
    async function scanExisting(onPage){
      const existing=new Set(); let cur=null;
      for(let guard=0; guard<100000; guard++){
        const cs=[api.orderBy('busca')]; if(cur) cs.push(api.startAfter(cur)); cs.push(api.limit(SCAN_PAGE));
        const snap=await api.getDocs(api.query(api.collection(db,REG),...cs));
        const docs=snap.docs||[]; if(!docs.length) break;
        for(const d of docs) existing.add(d.id);
        cur=docs[docs.length-1];
        if(onPage) onPage(existing.size);
        if(docs.length<SCAN_PAGE) break;
      }
      return existing;
    }

    /* ---- Execucao. Verifica existencia e cria so o que falta, por transacao. ----
       report: {total, created, preserved, failed, metaWritten, metaPreserved, metaFailed, failures:[]}.
       onProgress({phase, index, total, created, preserved, failed}). */
    async function run(json, onProgress){
      const emit=(phase,st)=>{ if(typeof onProgress==='function'){ try{ onProgress(Object.assign({phase},st)); }catch(e){} } };
      const v=validate(json);
      if(!v.matchesTarget) throw Object.assign(new Error('Projeto conectado nao e '+target+'. Importacao cancelada por seguranca.'),{code:'wrong-project'});
      if(!v.ok) throw Object.assign(new Error('Validacao falhou. Corrija o arquivo antes de importar.'),{code:'invalid-data',problems:v.problems});

      const records=recordsOf(json), total=records.length, sig=v.sig;
      let created=0, preserved=0, failed=0; const failures=[];
      const addFail=(id,e)=>{ failed++; if(failures.length<100) failures.push({id, erro:(e&&e.message)||String(e)}); };

      // 1) Verifica o que ja existe online (recalculado a cada tentativa).
      emit('scan',{index:0,total,created:0,preserved:0,failed:0});
      let existing;
      try{ existing=await scanExisting(n=>emit('scan',{index:0,total,created:0,preserved:0,failed:0,scanned:n})); }
      catch(e){ throw Object.assign(new Error('Falha ao ler os registros existentes: '+((e&&e.message)||e)),{code:'scan-failed'}); }

      const missing=[];
      for(const r of records){ if(existing.has(String(r.id))) preserved++; else missing.push(r); }
      emit('scan-done',{index:preserved,total,created,preserved,failed});

      // 2) Cria so os ausentes, por transacao (le dentro da transacao e grava so se ainda ausente).
      for(let s=0;s<missing.length;s+=TX_CHUNK){
        const chunk=missing.slice(s,s+TX_CHUNK);
        try{
          const res=await api.runTransaction(db, async tx=>{
            const snaps=await Promise.all(chunk.map(r=>tx.get(dref(REG,String(r.id)))));
            let c=0,p=0;
            for(let i=0;i<chunk.length;i++){ if(snaps[i].exists()){ p++; } else { tx.set(dref(REG,String(chunk[i].id)), chunk[i]); c++; } }
            return {c,p};
          });
          created+=res.c; preserved+=res.p;
        }catch(e){
          // fallback por documento: uma transacao por registro, para nao perder o lote inteiro numa falha pontual
          for(const r of chunk){
            try{
              const one=await api.runTransaction(db, async tx=>{ const s0=await tx.get(dref(REG,String(r.id))); if(s0.exists()) return 'p'; tx.set(dref(REG,String(r.id)), r); return 'c'; });
              if(one==='c') created++; else preserved++;
            }catch(err){ addFail(String(r.id), err); }
          }
        }
        await writeProgress({total, sig, created, preserved, failed, done:false});
        emit('lote',{index:Math.min(preserved+created+failed,total),total,created,preserved,failed});
      }

      // 3) Mapa (ilikia_meta/info): cria so se ausente, tambem por transacao. Nao sobrescreve.
      let metaWritten=false, metaPreserved=false, metaFailed=false;
      const meta = (json && json.meta) || null;
      if(meta && typeof meta==='object'){
        try{
          const r=await api.runTransaction(db, async tx=>{ const ms=await tx.get(dref(META_COL,META_DOC)); if(ms.exists()) return 'preserved'; tx.set(dref(META_COL,META_DOC), meta); return 'written'; });
          if(r==='preserved') metaPreserved=true; else metaWritten=true;
        }catch(e){ metaFailed=true; addFail(META_COL+'/'+META_DOC, e); }
      }

      // done so quando NAO ha pendencias; com qualquer falha, deixa aberto para nova tentativa.
      await writeProgress({total, sig, created, preserved, failed, done: failed===0});
      const report={total, created, preserved, failed, metaWritten, metaPreserved, metaFailed, failures};
      emit('fim', Object.assign({index:total},report));
      return report;
    }

    return {validate, run, getProgress, _target:target, _projectId:projectId, _signature:signature};
  }

  const exported={create, _signature:signature};
  if(typeof module!=='undefined'&&module.exports) module.exports=exported;
  else root.EfaTabelasImport=exported;
})(typeof window!=='undefined'?window:globalThis);
