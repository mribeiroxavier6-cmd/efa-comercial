(function(root){
  'use strict';
  /* ===================================================================
     Camada de dados do modulo Tabelas (ILIKIA) no Cloud Firestore.
     Mesma filosofia do cloud-store das Propostas: modulo puro, testavel
     com uma API Firestore simulada. Colecoes proprias, separadas das Propostas.
       - ilikia_registros/{id}         : um documento por registro
       - ilikia_historico/{autoId}     : log append-only de alteracoes
     Correcoes atendidas:
       - paginacao real (sem cortar em 600);
       - conflito campo a campo: reaplica SO o que o usuario mudou,
         preserva mudancas de outros nos demais campos; mesmo campo = decisao explicita;
       - confirma salvo so apos a transacao no servidor;
       - historico com usuario, data, campo, valor anterior, valor novo e versao.
     Sem travessao. Sem armazenamento local.
  =================================================================== */
  const REG='ilikia_registros', HIST='ilikia_historico';
  function error(code,message,extra){return Object.assign(new Error(message),Object.assign({code},extra||{}));}
  const round4=n=>Math.round(Number(n)*1e4)/1e4;

  function sameVal(a,b){
    if(a.kind!==b.kind) return false;
    if(a.kind==='blank') return true;
    if(a.kind==='money'||a.kind==='number') return round4(a.value)===round4(b.value);
    if(a.kind==='int'||a.kind==='zero') return Number(a.value)===Number(b.value);
    return String(a.value)===String(b.value);
  }
  const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const nf4=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:4});
  function label(o){ // rotulo textual de um valor para o historico (espelha a UI)
    if(o.kind==='blank'||o.value==null) return '(em branco)';
    if(o.kind==='zero') return '0';
    if(o.kind==='cotacao') return String(o.value);
    if(o.kind==='money') return 'R$ '+nf2.format(o.value);
    if(o.kind==='int') return String(o.value);
    if(o.kind==='number') return nf4.format(o.value);
    return String(o.value);
  }

  function create(api,db){
    const colReg=()=>api.collection(db,REG);
    const docReg=id=>api.doc(db,REG,id);

    /* ---- monta a query conforme os filtros, com indice MINIMO e deterministico ----
       Uma unica estrategia de servidor por caso; o resto filtra no cliente (matchRow):
         - 'busca'  : ha texto de busca -> where(tokens array-contains token0) + orderBy(busca).
                      Indice composto (tokens[array], busca). dataset/uf/regiao/classificacao refinam no cliente.
         - 'dataset': modalidade escolhida e sem busca -> where(dataset==) + orderBy(busca).
                      Indice composto (dataset, busca), que JA esta ativo no projeto. uf/regiao/classificacao no cliente.
         - 'scan'   : sem modalidade e sem busca (pode ter filtro geografico) -> orderBy(busca) apenas.
                      Indice de campo unico (automatico). uf/regiao/classificacao no cliente.
       AEREO_EXPRESSO cai em 'dataset' (orderBy busca); a ordenacao por 'ordem' e feita no cliente (modulo),
       para nao exigir o indice (dataset, ordem). */
    function buildConstraints(p){
      const cs=[];
      const tokens=normTokens(p.busca);
      let strategy;
      if(tokens.length){ cs.push(api.where('tokens','array-contains',tokens[0])); strategy='busca'; }
      else if(p.dataset){ cs.push(api.where('dataset','==',p.dataset)); strategy='dataset'; }
      else { strategy='scan'; }
      cs.push(api.orderBy('busca'));
      return {cs, tokens, strategy};
    }
    function normTokens(s){
      if(!s) return [];
      const n=String(s).normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
      return n? n.split(' ').filter(Boolean) : [];
    }
    // Refino no cliente: aplica os filtros que NAO foram para a query + a busca por substring (palavra inteira).
    function matchRow(row,p,tokens){
      if(p.dataset && row.dataset!==p.dataset) return false;
      if(p.uf && row.uf!==p.uf) return false;
      if(p.regiao && row.regiao!==p.regiao) return false;
      if(p.classificacao && row.classificacao!==p.classificacao) return false;
      if(tokens&&tokens.length){
        const hay=(row.busca||'')+' '+((row.tokens||[]).join(' '));
        if(!tokens.every(t=>hay.indexOf(t)>=0)) return false;
      }
      return true;
    }

    // ---- paginacao real: busca paginas ate reunir pageSize apos o refino no cliente ----
    // O cursor acompanha o ULTIMO documento EXAMINADO (nao o ultimo do lote). Quando o filtro no
    // cliente enche a pagina no meio de um lote, paramos ali e a proxima pagina retoma a partir desse
    // documento, sem pular o restante do lote. Sem isso, documentos nao examinados do lote se perdiam.
    async function queryPage(p){
      const pageSize=p.pageSize||50;
      const {cs,tokens,strategy}=buildConstraints(p);
      const out=[]; let cursor=p.cursor||null; let done=false; let pageFull=false; let scanned=0; const HARD=80;
      while(out.length<pageSize && !done && scanned<HARD){
        const extra=[];
        if(cursor) extra.push(api.startAfter(cursor));
        extra.push(api.limit(pageSize));
        const snap=await api.getDocs(api.query(colReg(),...cs,...extra));
        const docs=snap.docs||[];
        if(docs.length===0){ done=true; break; }
        pageFull=false;
        for(const d of docs){
          cursor=d;                                        // avanca o cursor a cada doc examinado
          if(matchRow(d.data(),p,tokens)) out.push(d.data());
          if(out.length>=pageSize){ pageFull=true; break; } // pagina cheia: pode ser no meio do lote
        }
        scanned++;
        if(pageFull) break;                                // retoma depois do ultimo doc examinado
        if(docs.length<pageSize) done=true;                // lote parcial consumido inteiro: servidor esgotou
      }
      return {rows:out, cursor:done?null:cursor, done, strategy};
    }

    async function getRecord(id){ const s=await api.getDoc(docReg(id)); return s.exists()?s.data():null; }
    async function getMeta(){ const s=await api.getDoc(api.doc(db,'ilikia_meta','info')); return s.exists()?s.data():null; }

    // Historico de um registro. Consulta so por igualdade (indice de campo unico, automatico)
    // e ordena no cliente por criado_em desc, para dispensar o indice composto (registro_id, criado_em).
    // O historico por registro e pequeno (poucas entradas), entao a ordenacao no cliente e barata.
    function tsMillis(v){ if(v==null) return 0; if(typeof v==='number') return v; if(v.toMillis) return v.toMillis(); if(v.seconds!=null) return v.seconds*1000+(v.nanoseconds?v.nanoseconds/1e6:0); const n=Date.parse(v); return isFinite(n)?n:0; }
    async function historico(id){
      const snap=await api.getDocs(api.query(api.collection(db,HIST),api.where('registro_id','==',id)));
      return snap.docs.map(d=>d.data()).sort((a,b)=>tsMillis(b.criado_em)-tsMillis(a.criado_em));
    }

    /* Gravacao com merge campo a campo dentro de uma transacao.
       patches: [{key, baseValue, baseKind, value, kind}]  baseX = valor que o usuario tinha ao carregar.
       Retorna {ok, record}. Lanca:
         code 'conflict' com .fields [{key,label,servidor,meu,base}] quando o MESMO campo divergiu;
         demais erros (ex.: rede) sobem como estao, sem confirmar salvo. */
    async function saveCampos(input){
      const {id, patches, usuario, motivo}=input;
      return api.runTransaction(db, async tx=>{
        const snap=await tx.get(docReg(id));
        if(!snap.exists()) throw error('invalid-data','Registro nao encontrado.');
        const cur=JSON.parse(JSON.stringify(snap.data()));
        const campos=cur.campos;
        const conflicts=[], applied=[];
        for(const p of patches){
          const idx=campos.findIndex(c=>c.key===p.key);
          if(idx<0) continue;
          const serverVal={value:campos[idx].value,kind:campos[idx].kind};
          const myBase={value:p.baseValue,kind:p.baseKind};
          const myNew={value:p.value,kind:p.kind};
          if(sameVal(serverVal,myNew)) continue;            // ja esta como quero: nada a fazer
          if(sameVal(serverVal,myBase)){                    // outro nao mexeu neste campo: aplico
            campos[idx]=Object.assign({},campos[idx],{value:myNew.value,kind:myNew.kind});
            applied.push({key:p.key,label:campos[idx].label,antes:serverVal,depois:myNew});
          } else {                                          // outro mudou ESTE campo para valor diferente: conflito
            conflicts.push({key:p.key,label:campos[idx].label,servidor:serverVal,meu:myNew,base:myBase});
          }
        }
        if(conflicts.length) throw error('conflict','Conflito em campo(s) alterado(s) por outra pessoa.',{fields:conflicts, versaoServidor:cur.versao});
        if(!applied.length) return {ok:true, record:cur, noChange:true};
        const novaVersao=(cur.versao||1)+1;
        cur.campos=campos; cur.versao=novaVersao; cur.updated_at=api.serverTimestamp(); cur.updated_by=usuario||null;
        tx.set(docReg(id), cur);
        for(const a of applied){
          const href=api.doc(api.collection(db,HIST));
          tx.set(href,{registro_id:id, campo:a.label, campo_key:a.key,
            valor_anterior:label(a.antes), valor_novo:label(a.depois),
            versao:novaVersao, usuario:usuario||null, motivo:motivo||null, criado_em:api.serverTimestamp()});
        }
        return {ok:true, record:cur, aplicados:applied.map(a=>a.key)};
      });
    }

    // ---- realtime: documento aberto e pagina atual da lista ----
    function subscribeRecord(id,cb){ return api.onSnapshot(docReg(id), s=>cb(s.exists()?s.data():null)); }
    function subscribeQuery(p,cb){
      const {cs,tokens}=buildConstraints(p);
      const q=api.query(colReg(),...cs,api.limit(p.pageSize||50));
      return api.onSnapshot(q, snap=>cb(snap.docs.map(d=>d.data()).filter(r=>matchRow(r,p,tokens))));
    }

    return {queryPage, getRecord, getMeta, historico, saveCampos, subscribeRecord, subscribeQuery, _sameVal:sameVal, _label:label};
  }
  const exported={create, label, sameVal};
  if(typeof module!=='undefined'&&module.exports) module.exports=exported;
  else root.EfaTabelasStore=exported;
})(typeof window!=='undefined'?window:globalThis);
