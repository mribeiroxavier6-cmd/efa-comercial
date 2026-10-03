(function(){
  'use strict';
  /* ===================================================================
     Modulo Tabelas (ILIKIA) - interface, dentro da mesma pagina da Area Comercial.
     Reaproveita a autenticacao do projeto (getEfaCloud -> cloud.tabelas).
     Dados vem do Firestore (apos login); nao ha base publica em arquivo.
     Sem travessao. Sem armazenamento local.
  =================================================================== */
  const UFS=["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
  const REGIOES=["Centro-Oeste","Nordeste","Norte","Sudeste","Sul"];
  const CLASSIF=["Capital","Interior"];
  const DATASETS=[["","Todas as modalidades"],["RODOVIARIO","Rodoviario Fracionado"],["AEREO_CONVENCIONAL","Aereo Convencional"],["AEREO_EXPRESSO","Aereo Expresso"],["CIDADES","Cidades Atendidas"],["PRAZOS","Prazos (Redespacho)"]];
  const GRUPOS_EXPRESSO=[
    {regiao:"SUL",ufs:["PR","SC","RS"]},{regiao:"SUDESTE",ufs:["SP","RJ","MG","ES"]},
    {regiao:"CENTRO-OESTE",ufs:["DF","GO","MS","MT"]},{regiao:"NORTE",ufs:["AC","AM","AP","PA","RO","RR","TO"]},
    {regiao:"NORDESTE",ufs:["AL","BA","CE","MA","PB","PE","PI","RN","SE"]}];
  const PAGE=50;

  const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e;};
  const norm=s=>s==null?"":String(s).normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim().toLowerCase();
  const nf2=new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const nf4=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:4});
  function fmtDate(v){ try{ if(v&&v.seconds)return new Date(v.seconds*1000).toLocaleString("pt-BR"); if(v&&v.toDate)return v.toDate().toLocaleString("pt-BR"); return new Date(v).toLocaleString("pt-BR"); }catch(e){ return String(v||""); } }
  function valText(c){ if(c.kind==="blank"||c.value==null)return "(em branco)"; if(c.kind==="zero")return "0"; if(c.kind==="cotacao")return String(c.value); if(c.kind==="money")return "R$ "+nf2.format(c.value); if(c.kind==="int")return String(c.value); if(c.kind==="number")return nf4.format(c.value); return String(c.value); }
  function valNode(c){ const s=el("span","tbx-v tbx-"+(c.kind==="blank"?"blank":c.kind==="cotacao"?"cot":c.kind==="zero"?"zero":/money|number|int/.test(c.kind)?"num":"text")); s.textContent=valText(c); return s; }

  let CSS_DONE=false;
  function injectCSS(){ if(CSS_DONE)return; CSS_DONE=true; const s=document.createElement("style"); s.id="tbx-style"; s.textContent=STYLE; document.head.appendChild(s); }

  const App={
    host:null, cloud:null, mounted:false, user:null,
    filters:{dataset:"",uf:"",regiao:"",classificacao:"",busca:""},
    rows:[], cursor:null, done:true, paginated:false, pendingRefresh:false,
    unsubList:null, unsubRec:null,
    selected:null, mode:"consulta", edit:null, tab:"ficha", expCol:null, meta:null,

    async open(){
      injectCSS();
      if(!this.mounted){ this.buildShell(); this.mounted=true; }
      this.host.style.display="block";
      try{ this.cloud=await window.getEfaCloud(); this.user=this.cloud.currentUserEmail&&this.cloud.currentUserEmail(); }
      catch(e){ this.toast("Falha ao conectar: "+(e.message||e),"err"); }
      this.$(".tbx-user").textContent=this.user||"";
      const impBtn=this.$(".tbx-imp-btn");
      if(impBtn) impBtn.style.display=(this.cloud&&this.cloud.isAdmin&&this.cloud.isAdmin()&&this.cloud.importer)?"inline-flex":"none";
      this.setLogos();
      if(this.cloud){ try{ this.meta=await this.cloud.tabelas.getMeta(); }catch(e){ this.meta=null; } }
      this.applyFilters();
    },
    setLogos(){
      // marcas oficiais da Area Comercial (as mesmas das Propostas), via EFA_ASSETS; fallback nos imgs da pagina
      const A=window.EFA_ASSETS||{};
      const efaSrc=A.logo_efa || ((document.getElementById("homeEfa")||{}).src) || "";
      const cvsSrc=A.logo_cvs || ((document.getElementById("homeCvs")||{}).src) || "";
      const e=this.$(".tbx-logo-efa"), c=this.$(".tbx-logo-cvs");
      if(efaSrc){ e.src=efaSrc; e.style.display=""; } else { e.style.display="none"; }
      if(cvsSrc){ c.src=cvsSrc; c.style.display=""; } else { c.style.display="none"; }
    },
    close(){ if(this.unsubList)this.unsubList(); if(this.unsubRec)this.unsubRec(); this.unsubList=this.unsubRec=null; this.host.style.display="none"; },
    $(sel){ return this.host.querySelector(sel); },

    buildShell(){
      const h=document.getElementById("tabelasView"); this.host=h;
      h.innerHTML=SHELL;
      // filtros
      const fill=(sel,items,ph)=>{ const s=this.$(sel); s.innerHTML=""; s.appendChild(new Option(ph,"")); items.forEach(v=>s.appendChild(new Option(v,v))); };
      const mod=this.$(".tbx-f-mod"); mod.innerHTML=""; DATASETS.forEach(([v,l])=>mod.appendChild(new Option(l,v)));
      fill(".tbx-f-uf",UFS,"Todas"); fill(".tbx-f-reg",REGIOES,"Todas"); fill(".tbx-f-cls",CLASSIF,"Todas");
      // eventos
      this.$(".tbx-back").onclick=()=>{ if(this.leaveGuard()) this.close(); };
      ["tbx-f-mod","tbx-f-uf","tbx-f-reg","tbx-f-cls"].forEach(c=>this.$("."+c).addEventListener("change",()=>{ this.readFilters(); this.applyFilters(); }));
      let deb; this.$(".tbx-f-busca").addEventListener("input",()=>{ clearTimeout(deb); deb=setTimeout(()=>{ this.readFilters(); this.applyFilters(); },200); });
      this.$(".tbx-scrim").onclick=()=>this.closePanel();
      this.$(".tbx-x").onclick=()=>this.closePanel();
      this.$(".tbx-tab-ficha").onclick=()=>{ this.tab="ficha"; this.renderPanel(); };
      this.$(".tbx-tab-hist").onclick=()=>{ this.tab="hist"; this.renderPanel(); };
      this.$(".tbx-refresh").onclick=()=>{ this.pendingRefresh=false; this.applyFilters(); };
      window.addEventListener("beforeunload",e=>{ if(this.edit&&this.edit.dirty){ e.preventDefault(); e.returnValue=""; } });
      this.wireImport();
    },
    readFilters(){ this.filters={ dataset:this.$(".tbx-f-mod").value, uf:this.$(".tbx-f-uf").value, regiao:this.$(".tbx-f-reg").value, classificacao:this.$(".tbx-f-cls").value, busca:this.$(".tbx-f-busca").value }; },

    isExpresso(){ return this.filters.dataset==="AEREO_EXPRESSO"; },
    isMapMode(){ const f=this.filters; return !f.dataset && !f.busca && !f.uf && !f.regiao && !f.classificacao; },
    queryParams(){
      const f=this.filters;
      if(this.isExpresso()) return {dataset:"AEREO_EXPRESSO", pageSize:70};
      return {dataset:f.dataset, uf:f.uf, regiao:f.regiao, classificacao:f.classificacao, busca:f.busca, pageSize:PAGE};
    },

    async applyFilters(){
      if(!this.cloud){ return; }
      this.rows=[]; this.cursor=null; this.done=true; this.paginated=false; this.pendingRefresh=false;
      this.$(".tbx-refresh").style.display="none";
      // (re)assina realtime da pagina 1
      if(this.unsubList){ this.unsubList(); this.unsubList=null; }
      if(this.isMapMode()){ this.render(); return; }   // mapa: visao inicial, nao consulta lista
      this.renderLoading();
      const params=this.queryParams();
      try{
        const p=await this.cloud.tabelas.queryPage(params);
        this.rows=p.rows; this.cursor=p.cursor; this.done=p.done; this.render();
      }catch(e){ this.renderError(e); return; }
      // realtime: pagina 1 do filtro atual
      try{
        this.unsubList=this.cloud.tabelas.subscribeQuery(params,(rows)=>{
          if(this.paginated){ if(!this.pendingRefresh){ this.pendingRefresh=true; this.$(".tbx-refresh").style.display="inline-flex"; } return; }
          this.rows=rows; this.render(); // mantem painel aberto
        });
      }catch(e){ /* realtime indisponivel nao quebra a consulta */ }
    },
    async loadMore(){
      if(this.done||!this.cursor)return;
      this.paginated=true;
      try{ const p=await this.cloud.tabelas.queryPage(Object.assign(this.queryParams(),{cursor:this.cursor})); this.rows=this.rows.concat(p.rows); this.cursor=p.cursor; this.done=p.done; this.render(); }
      catch(e){ this.toast("Falha ao carregar mais: "+(e.message||e),"err"); }
    },

    render(){ if(this.isMapMode()) this.renderMap(); else if(this.isExpresso()) this.renderMatrix(); else this.renderList(); this.renderPanel(); },
    renderLoading(){ this.$(".tbx-content").innerHTML='<div class="tbx-loading"><span class="tbx-spin"></span> Carregando...</div>'; },

    // ---------- Mapa (Todas as modalidades) ----------
    MAP_RAMP:["#DCE9F7","#A9C8E8","#6BA0D6","#2E6DB4","#123A75"],
    MAP_THR:[50,150,300,500],
    mapBucket(n){ if(n==null) return -1; let i=0; while(i<this.MAP_THR.length && n>this.MAP_THR[i]) i++; return i; },
    renderMap(){
      const body=this.$(".tbx-content");
      const geo=window.BR_UF_GEO, mapa=this.meta&&this.meta.mapa;
      if(!geo || !mapa || !mapa.por_uf){
        body.innerHTML='<div class="tbx-empty"><b>Mapa indisponivel</b><div class="tbx-hint">'+(!geo?'Geometria (br-ufs.js) nao carregada.':'Agregado do mapa ainda nao importado no Firestore (ilikia_meta/info).')+'</div></div>';
        this.updateCount(0); return;
      }
      const counts=mapa.por_uf, RAMP=this.MAP_RAMP;
      let paths="";
      for(const uf in geo.ufs){ const u=geo.ufs[uf]; const n=(uf in counts)?counts[uf]:null; const b=this.mapBucket(n); const fill=b<0?"#E2E7EE":RAMP[b];
        paths+='<path class="tbx-uf" data-uf="'+uf+'" d="'+u.d+'" fill="'+fill+'"></path>'; }
      let labs="";
      for(const uf in geo.ufs){ const u=geo.ufs[uf]; const b=this.mapBucket((uf in counts)?counts[uf]:null); labs+='<text class="tbx-uflab" x="'+u.cx+'" y="'+u.cy+'" text-anchor="middle" fill="'+(b>=3?'#fff':'#13181F')+'">'+uf+'</text>'; }
      const legLabels=["1 a 50","51 a 150","151 a 300","301 a 500","mais de 500"];
      const legend=legLabels.map((l,i)=>'<span class="tbx-lgi"><i style="background:'+RAMP[i]+'"></i>'+l+'</span>').join('')+'<span class="tbx-lgi"><i style="background:#E2E7EE"></i>sem informacao</span>';
      body.innerHTML=
        '<div class="tbx-mapwrap">'+
          '<div class="tbx-maptop"><div><div class="tbx-maptitle">'+escapeHtml(mapa.metrica_label||"Localidades cadastradas")+' por UF</div>'+
          '<div class="tbx-mapnote">Fonte: aba Cidades Atendidas. Clique num estado para ver as localidades. Todas estao como Sob Cotacao: cobertura listada, nao atendimento irrestrito.</div></div></div>'+
          '<div class="tbx-mapgrid"><div class="tbx-mapsvg"><svg viewBox="'+geo.viewBox+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa do Brasil por UF">'+paths+labs+'</svg>'+
          '<div class="tbx-maptip" id="tbxMaptip"></div></div>'+
          '<div class="tbx-mapside"><div class="tbx-lg">'+legend+'</div><div class="tbx-maplimit">Metrica provisoria: '+escapeHtml(mapa.metrica_nota||"")+'</div></div></div>'+
          '<div class="tbx-mapsrc">Limites: '+escapeHtml((geo.fonte||"IBGE"))+'</div>'+
        '</div>';
      // interacoes
      const tip=body.querySelector("#tbxMaptip");
      body.querySelectorAll("path.tbx-uf").forEach(p=>{
        const uf=p.getAttribute("data-uf"); const u=geo.ufs[uf]; const n=(uf in counts)?counts[uf]:null;
        const show=(ev)=>{ tip.innerHTML='<b>'+escapeHtml(u.nome)+' ('+uf+')</b><br>'+(n==null?'sem informacao':(n+' localidade'+(n!==1?'s':'')+' cadastrada'+(n!==1?'s':'')));
          tip.style.display="block"; const wrap=body.querySelector(".tbx-mapsvg").getBoundingClientRect();
          const cx=ev&&ev.clientX!=null?ev.clientX:wrap.left+wrap.width/2, cy=ev&&ev.clientY!=null?ev.clientY:wrap.top;
          let x=cx-wrap.left+12, y=cy-wrap.top+12; if(x>wrap.width-150)x=wrap.width-150; tip.style.left=x+"px"; tip.style.top=y+"px"; };
        p.addEventListener("mouseenter",show); p.addEventListener("mousemove",show);
        p.addEventListener("mouseleave",()=>{ tip.style.display="none"; });
        p.addEventListener("click",()=>this.drillUF(uf));
      });
      this.$(".tbx-count").innerHTML="<b>"+(mapa.total_localidades!=null?mapa.total_localidades:"")+"</b> localidades cadastradas em <b>27</b> UFs";
    },
    drillUF(uf){
      this.filters={dataset:"CIDADES",uf:uf,regiao:"",classificacao:"",busca:""};
      this.$(".tbx-f-mod").value="CIDADES"; this.$(".tbx-f-uf").value=uf; this.$(".tbx-f-reg").value=""; this.$(".tbx-f-cls").value=""; this.$(".tbx-f-busca").value="";
      this.applyFilters();
    },

    DLABEL:{CIDADES:"Cidades Atendidas",AEREO_EXPRESSO:"Aéreo Expresso",AEREO_CONVENCIONAL:"Aéreo Convencional",RODOVIARIO:"Rodoviário Fracionado",PRAZOS:"Prazos (Redespacho)"},
    dLabel(r){ return this.DLABEL[r.dataset] || r.modalidade; },
    col5(){
      const ds=this.filters.dataset;
      if(ds==="AEREO_CONVENCIONAL") return {header:"Prazos", get:r=>r.campos.find(x=>x.key==="prazo")};
      if(ds==="CIDADES"||ds==="PRAZOS") return {header:"Sob cotação", get:r=>r.campos.find(x=>x.key==="tipo_class")};
      if(ds==="RODOVIARIO") return {header:"Classif.", get:r=>r.classificacao};
      return {header:"Situação", get:r=> r.classificacao || r.campos.find(x=>x.key==="prazo") || r.campos.find(x=>x.key==="tipo_class") };
    },
    renderList(){
      const body=this.$(".tbx-content");
      const c5=this.col5();
      let html='<div class="tbx-tablewrap"><table class="tbx-table"><thead><tr>'+
        '<th>Localidade</th><th>UF</th><th>Sigla</th><th>Regiao</th><th>'+escapeHtml(c5.header)+'</th><th>Modalidade</th><th>Valor de referencia</th></tr></thead><tbody></tbody></table></div>';
      body.innerHTML=html;
      const tb=body.querySelector("tbody");
      if(!this.rows.length){ body.innerHTML='<div class="tbx-empty"><b>Nenhum registro encontrado</b><div>Ajuste a busca ou os filtros. A busca ignora acento e maiuscula.</div></div>'; this.updateCount(0); return; }
      this.rows.forEach(r=>tb.appendChild(this.rowNode(r)));
      // carregar mais
      if(!this.done){ const bar=el("div","tbx-more"); const b=el("button","tbx-link","Carregar mais"); b.onclick=()=>this.loadMore(); bar.appendChild(b); body.appendChild(bar); }
      this.updateCount(this.rows.length);
    },
    rowNode(r){
      const tr=el("tr"); if(this.selected&&this.selected.id===r.id)tr.className="tbx-sel";
      const td=(n)=>{const c=el("td"); if(typeof n==="string")c.textContent=n; else if(n==null)c.appendChild(el("span","tbx-muted","-")); else c.appendChild(n); return c;};
      tr.appendChild((()=>{const c=td(el("span","tbx-loc",String(r.localidade)));return c;})());
      tr.appendChild(td(r.uf||null)); tr.appendChild(td(r.sigla||null)); tr.appendChild(td(r.regiao||null));
      const c5=this.col5(), v5=c5.get(r); let cell5=null;
      if(v5!=null && v5!==""){ if(typeof v5==="string") cell5=v5; else { const w=el("span"); w.appendChild(valNode(v5)); if(v5.unit&&/int|number|money/.test(v5.kind)){ w.appendChild(el("span","tbx-un"," "+v5.unit)); } cell5=w; } }
      tr.appendChild(td(cell5));
      tr.appendChild(td(el("span","tbx-ds tbx-ds-"+r.dataset,this.dLabel(r))));
      const ref=r.campos.find(c=>c.kind==="money")||r.campos.find(c=>c.kind==="cotacao")||r.campos[0];
      tr.appendChild(td(ref?valNode(ref):null));
      tr.onclick=()=>this.openRecord(r.id);
      return tr;
    },

    renderMatrix(){
      const body=this.$(".tbx-content");
      // coluna selecionada pela regiao/UF
      let selReg=null; const f=this.filters;
      if(f.regiao){ selReg=GRUPOS_EXPRESSO.find(g=>norm(g.regiao)===norm(f.regiao))||GRUPOS_EXPRESSO.find(g=>norm(g.regiao).indexOf(norm(f.regiao))>=0); }
      if(!selReg && f.uf){ selReg=GRUPOS_EXPRESSO.find(g=>g.ufs.includes(f.uf)); }
      const faixas=this.rows.slice().sort((a,b)=>(a.ordem||0)-(b.ordem||0));
      let head='<tr><th class="tbx-sticky">Faixa de peso</th>';
      GRUPOS_EXPRESSO.forEach(g=>{ const on=selReg&&selReg.regiao===g.regiao; head+='<th class="'+(on?"tbx-colon":"")+(selReg&&!on?" tbx-coloff":"")+'">'+g.regiao+'<div class="tbx-ufs">'+g.ufs.join(" ")+'</div></th>'; });
      head+='</tr>';
      let rows="";
      faixas.forEach(r=>{
        rows+='<tr data-id="'+r.id+'" class="tbx-mrow'+(this.selected&&this.selected.id===r.id?" tbx-sel":"")+'">';
        rows+='<td class="tbx-sticky tbx-loc">'+escapeHtml(r.localidade)+(r.is_excedente?' <span class="tbx-badge">excedente</span>':'')+'</td>';
        GRUPOS_EXPRESSO.forEach((g,i)=>{ const c=r.campos[i]; const on=selReg&&selReg.regiao===g.regiao; rows+='<td class="tbx-num'+(on?" tbx-colon":"")+(selReg&&!on?" tbx-coloff":"")+'">'+valText(c)+'</td>'; });
        rows+='</tr>';
      });
      body.innerHTML='<div class="tbx-exphint">Origem: Serra - ES. Matriz faixa de peso x grupo de regiao. '+(selReg?('Coluna destacada: '+selReg.regiao+'.'):'Selecione uma regiao ou UF para destacar a coluna.')+' Clique numa faixa para abrir e editar as tarifas.</div>'+
        '<div class="tbx-tablewrap"><table class="tbx-table tbx-matrix"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div>';
      body.querySelectorAll("tr.tbx-mrow").forEach(tr=>tr.onclick=()=>this.openRecord(tr.getAttribute("data-id")));
      this.updateCount(faixas.length);
    },
    updateCount(n){ this.$(".tbx-count").innerHTML="<b>"+n+"</b> registro"+(n!==1?"s":"")+(this.isExpresso()?"":(this.done?"":" (parcial, carregue mais)")); },
    renderError(e){ this.$(".tbx-content").innerHTML='<div class="tbx-empty"><b>Nao foi possivel consultar</b><div>'+escapeHtml(e&&e.message||String(e))+'</div><div class="tbx-hint">Se for a primeira consulta, confirme que os dados foram importados no Firestore e que seu acesso esta autorizado.</div></div>'; this.updateCount(0); },

    async openRecord(id){
      if(!this.leaveGuard())return;
      let rec; try{ rec=await this.cloud.tabelas.getRecord(id); }catch(e){ this.toast("Falha ao abrir: "+(e.message||e),"err"); return; }
      if(!rec){ this.toast("Registro nao encontrado.","err"); return; }
      this.selected=rec; this.mode="consulta"; this.tab="ficha"; this.edit=null;
      if(this.unsubRec)this.unsubRec();
      this.unsubRec=this.cloud.tabelas.subscribeRecord(id,(fresh)=>{ if(!fresh)return;
        // atualiza linha na lista
        const i=this.rows.findIndex(x=>x.id===id); if(i>=0){ this.rows[i]=fresh; if(!this.isExpresso())this.renderList(); else this.renderMatrix(); }
        if(this.selected&&this.selected.id===id){
          if(this.mode==="edicao"&&this.edit&&this.edit.dirty){ this.edit.remoteChanged=true; this.renderPanel(); }
          else { this.selected=fresh; this.renderPanel(); }
        }
      });
      this.openPanel(); this.renderPanel();
    },
    openPanel(){ this.$(".tbx-scrim").classList.add("on"); this.$(".tbx-panel").classList.add("on"); },
    closePanel(){ if(!this.leaveGuard())return; this.$(".tbx-scrim").classList.remove("on"); this.$(".tbx-panel").classList.remove("on"); this.selected=null; this.edit=null; if(this.unsubRec){this.unsubRec();this.unsubRec=null;} this.render(); },
    leaveGuard(){ if(this.edit&&this.edit.dirty){ return confirm("Ha alteracoes nao salvas. Sair e descartar?"); } return true; },

    renderPanel(){
      const r=this.selected; const p=this.$(".tbx-panel"); if(!r){ return; }
      this.$(".tbx-pt").textContent=String(r.localidade);
      this.$(".tbx-ps").textContent=this.dLabel(r)+"  |  origem "+r.origem+(r.classificacao?("  |  "+r.classificacao):"");
      this.$(".tbx-tab-ficha").classList.toggle("on",this.tab==="ficha");
      this.$(".tbx-tab-hist").classList.toggle("on",this.tab==="hist");
      const body=this.$(".tbx-pbody"), foot=this.$(".tbx-pfoot"); body.innerHTML=""; foot.innerHTML="";
      if(this.tab==="hist"){ this.renderHist(body,foot); return; }
      if(this.mode==="edicao") this.renderEdit(body,foot); else this.renderConsulta(body,foot);
    },
    ident(r){ const g=el("div","tbx-ident"); const add=(k,v,cls)=>{ g.appendChild(el("dt",null,k)); g.appendChild(el("dd",cls||null,(v==null||v==="")?"-":String(v))); };
      add("Localidade",r.localidade,"tbx-locv"); add("Modalidade",r.modalidade); add("Origem",r.origem);
      if(r.uf!=null)add("UF",r.uf); if(r.sigla!=null)add("Sigla",r.sigla); if(r.regiao!=null)add("Regiao",r.regiao);
      if(r.classificacao!=null)add("Classificacao",r.classificacao);
      if(r.faixa_peso)add("Faixa de peso",r.faixa_peso);
      add("Fonte","aba "+(r.src&&r.src.sheet||"")+", linha "+(r.src&&r.src.row||"")); add("Versao","v"+(r.versao||1));
      return g; },
    renderConsulta(body,foot){
      const r=this.selected;
      const g1=el("div","tbx-grp"); g1.appendChild(el("p","tbx-gt","Identificacao do registro")); g1.appendChild(this.ident(r)); body.appendChild(g1);
      if(r.dataset==="AEREO_EXPRESSO"){ const note=el("p","tbx-hint","Tarifas por grupo de regiao (cada grupo cobre as UFs indicadas). Edite uma regiao sem afetar as outras."); body.appendChild(note); }
      const g2=el("div","tbx-grp"); g2.appendChild(el("p","tbx-gt","Valores atuais"));
      r.campos.forEach(c=>{ const row=el("div","tbx-frow"); const l=el("div","tbx-fl",c.label); if(c.ufs){ const u=el("div","tbx-ufline",c.ufs.join(" ")); l.appendChild(u);} row.appendChild(l);
        const fv=el("div","tbx-fv"); fv.appendChild(valNode(c)); if(c.unit&&/money|number|int/.test(c.kind)){ fv.appendChild(el("span","tbx-un"," "+c.unit)); } row.appendChild(fv); g2.appendChild(row); });
      body.appendChild(g2);
      body.appendChild(el("p","tbx-hint","A ficha abre em consulta. Clique em Atualizar para editar. A busca e os filtros continuam ao fundo."));
      const edit=el("button","tbx-b-edit","Atualizar"); edit.onclick=()=>this.startEdit(); foot.appendChild(edit);
    },
    kindOpts(c){
      if(c.key==="prazo_entrega"||c.key==="prazo") return [["int","Numero (dias)"],["blank","Em branco"],["cotacao","Sob cotacao"],["text","Texto"]];
      if(c.unit==="R$"||c.unit==="R$/kg"||/^reg_/.test(c.key)||c.key==="taxa_min"||c.key==="preco_kg"||c.key==="peso_min") return [["money","Numero"],["zero","Zero"],["blank","Em branco"],["cotacao","Sob cotacao"],["text","Texto"]];
      return [["text","Texto"],["cotacao","Sob cotacao"],["blank","Em branco"]];
    },
    startEdit(){ const r=this.selected; this.mode="edicao"; this.edit={dirty:false,remoteChanged:false,conflict:null,fields:{}};
      r.campos.forEach(c=>this.edit.fields[c.key]={kind:c.kind,value:c.value,origKind:c.kind,origValue:c.value}); this.renderPanel(); },
    diffs(){ const r=this.selected,es=this.edit,out=[]; r.campos.forEach(c=>{ const st=es.fields[c.key]; if(!st)return; if(st.kind!==st.origKind||String(st.value)!==String(st.origValue)) out.push({key:c.key,label:c.label,antes:valText({value:st.origValue,kind:st.origKind}),depois:valText({value:st.value,kind:st.kind})}); }); return out; },
    renderEdit(body,foot){
      const r=this.selected,es=this.edit;
      if(es.conflict){ body.appendChild(this.conflictBox(es.conflict)); }
      if(es.remoteChanged&&!es.conflict){ const w=el("div","tbx-offbox"); w.appendChild(el("div","tbx-ct","Este registro mudou em outro acesso")); w.appendChild(el("div",null,"Suas edicoes foram mantidas. Ao salvar, campos em conflito serao mostrados para voce decidir; os demais serao mesclados.")); body.appendChild(w); }
      const g1=el("div","tbx-grp"); g1.appendChild(el("p","tbx-gt","Identificacao (nao editavel)")); g1.appendChild(this.ident(r)); body.appendChild(g1);
      const diffBox=el("div"); diffBox.className="tbx-diffbox"; body.appendChild(diffBox);
      const g2=el("div","tbx-grp"); g2.appendChild(el("p","tbx-gt","Campos editaveis")); r.campos.forEach(c=>g2.appendChild(this.editRow(c))); body.appendChild(g2);
      body.appendChild(el("p","tbx-hint","Escolha o tipo de valor (numero, zero, em branco, sob cotacao, texto). Campo em branco nao vira zero. Edite so o que precisa."));
      this.renderDiffBox();
      const dirty=el("div","tbx-dirty"); dirty.textContent=es.dirty?"Alteracoes nao salvas":"Sem alteracoes"; if(!es.dirty)dirty.style.visibility="hidden"; foot.appendChild(dirty);
      const cancel=el("button","tbx-b-cancel","Cancelar"); cancel.onclick=()=>this.cancelEdit(); foot.appendChild(cancel);
      const save=el("button","tbx-b-save","Salvar alteracoes"); save.disabled=!es.dirty||this.anyInvalid(); save.onclick=()=>this.save(); foot.appendChild(save);
    },
    anyInvalid(){ return Object.values(this.edit.fields).some(s=>s._invalid); },
    renderDiffBox(){ const box=this.$(".tbx-diffbox"); if(!box)return; box.innerHTML=""; const d=this.diffs(); if(!d.length)return;
      const w=el("div","tbx-diff"); w.appendChild(el("div","tbx-difft","Resumo das diferencas ("+d.length+")"));
      d.forEach(df=>{ const r=el("div","tbx-dr"); r.appendChild(el("span","tbx-k",df.label)); r.appendChild(el("span","tbx-old",df.antes)); r.appendChild(el("span","tbx-arw","->")); r.appendChild(el("span","tbx-new",df.depois)); w.appendChild(r); }); box.appendChild(w); },
    updateLive(){ const es=this.edit; if(!es)return; const d=this.diffs(); es.dirty=d.length>0; this.renderDiffBox();
      const save=this.$(".tbx-b-save"); if(save)save.disabled=!es.dirty||this.anyInvalid();
      const dl=this.$(".tbx-dirty"); if(dl){ dl.style.visibility=es.dirty?"visible":"hidden"; dl.textContent="Alteracoes nao salvas"; }
      this.host.querySelectorAll(".tbx-feditrow").forEach(fr=>{ const k=fr.getAttribute("data-key"); const st=es.fields[k]; if(!st)return; const ch=(st.kind!==st.origKind)||(String(st.value)!==String(st.origValue)); const ec=fr.querySelector(".tbx-ec"); if(ec)ec.classList.toggle("changed",ch); let fl=fr.querySelector(".tbx-chg"); const head=fr.querySelector(".tbx-efl"); if(ch&&!fl)head.appendChild(el("span","tbx-chg","alterado")); if(!ch&&fl)fl.remove(); }); },
    editRow(c){ const es=this.edit,st=es.fields[c.key]; const wrap=el("div","tbx-feditrow"); wrap.setAttribute("data-key",c.key);
      const head=el("div","tbx-efl"); head.appendChild(el("span",null,c.label+(c.unit?(" ("+c.unit+")"):""))); if(c.ufs)head.appendChild(el("span","tbx-ufmini"," "+c.ufs.join(" ")));
      const ch=(st.kind!==st.origKind)||(String(st.value)!==String(st.origValue)); if(ch)head.appendChild(el("span","tbx-chg","alterado")); wrap.appendChild(head);
      const ec=el("div","tbx-ec"+(ch?" changed":"")); const kinds=el("div","tbx-kinds");
      this.kindOpts(c).forEach(([k,lab])=>{ const b=el("button",null,lab); if(st.kind===k)b.classList.add("on"); b.onclick=()=>{ st.kind=k; if(k==="zero")st.value=0; else if(k==="blank")st.value=null; else if(k==="cotacao"){ if(!(typeof st.value==="string"&&norm(st.value)==="sob cotacao"))st.value="Sob Cotação"; } st._invalid=false; this.updateLiveAfterKind(); }; kinds.appendChild(b); });
      ec.appendChild(kinds); const inrow=el("div","tbx-inrow");
      if(/money|number|int/.test(st.kind)){ if(c.unit)inrow.appendChild(el("span","tbx-prefix",c.unit)); const inp=el("input","tbx-num"); inp.type="text"; inp.inputMode="decimal"; inp.value=st.value==null?"":String(st.value).replace(".",","); inp.oninput=()=>{ const raw=inp.value.trim().replace(/\./g,"").replace(",","."); const n=Number(raw); if(inp.value.trim()===""){st._invalid=true;} else if(!isFinite(n)){st._invalid=true;} else { st._invalid=false; st.value=st.kind==="int"?Math.round(n):n; } this.updateLive(); }; inrow.appendChild(inp); }
      else if(st.kind==="text"){ const inp=el("input","tbx-num"); inp.type="text"; inp.style.textAlign="left"; inp.value=st.value==null?"":String(st.value); inp.oninput=()=>{ st.value=inp.value; st._invalid=(inp.value.trim()===""); this.updateLive(); }; inrow.appendChild(inp); }
      else if(st.kind==="cotacao")inrow.appendChild(el("span","tbx-st","Valor: Sob Cotacao"));
      else if(st.kind==="blank")inrow.appendChild(el("span","tbx-st","Campo em branco (informacao ausente)"));
      else if(st.kind==="zero")inrow.appendChild(el("span","tbx-st","Valor: 0"));
      ec.appendChild(inrow); if(st._invalid){ const w=el("span","tbx-st tbx-inv","Valor invalido para o tipo escolhido."); ec.appendChild(w);} wrap.appendChild(ec); return wrap;
    },
    updateLiveAfterKind(){ this.renderPanel(); }, // mudanca de tipo recria inputs
    cancelEdit(){ if(this.edit.dirty&&!confirm("Descartar as alteracoes nao salvas?"))return; this.mode="consulta"; this.edit=null; this.renderPanel(); },

    buildPatches(){ const r=this.selected,es=this.edit,ps=[]; r.campos.forEach(c=>{ const st=es.fields[c.key]; const ch=(st.kind!==st.origKind)||(String(st.value)!==String(st.origValue)); if(ch)ps.push({key:c.key,baseValue:st.origValue,baseKind:st.origKind,value:st.value,kind:st.kind}); }); return ps; },
    async save(){
      const es=this.edit; if(this.anyInvalid()){ this.toast("Corrija os valores invalidos.","err"); return; }
      const patches=this.buildPatches(); if(!patches.length){ this.toast("Nada para salvar.","warn"); return; }
      const save=this.$(".tbx-b-save"); if(save){save.disabled=true;save.textContent="Salvando...";}
      let res; try{ res=await this.cloud.tabelas.saveCampos({id:this.selected.id,patches,motivo:null}); }
      catch(e){
        if(e&&e.code==="conflict"){ es.conflict={fields:e.fields,originais:patches}; this.renderPanel(); this.toast("Conflito em campo alterado por outra pessoa. Decida abaixo.","warn"); return; }
        // falha de conexao / outro erro: nao confirma salvo, preserva preenchimento
        es.offline=true; this.renderPanel(); this.toast("Nao foi possivel salvar (sem conexao ou erro). Seu preenchimento foi mantido para tentar de novo.","err"); return;
      }
      this.selected=res.record; this.mode="consulta"; this.edit=null;
      const i=this.rows.findIndex(x=>x.id===res.record.id); if(i>=0)this.rows[i]=res.record; this.render();
      this.toast(res.noChange?"Nenhuma mudanca efetiva.":"Salvo com sucesso na base.","ok");
    },
    conflictBox(cf){
      const box=el("div","tbx-conflict"); box.appendChild(el("div","tbx-ct","Conflito de edicao"));
      box.appendChild(el("div",null,"Outra pessoa alterou o(s) mesmo(s) campo(s) enquanto voce editava. Decida cada um. Os campos que so voce mudou serao mesclados automaticamente."));
      cf.fields.forEach(fl=>{ const row=el("div","tbx-cfrow"); row.appendChild(el("div","tbx-cflab",fl.label));
        const opts=el("div","tbx-cfopts");
        const mine=el("button","tbx-cfbtn on","Manter o meu: "+valText(fl.meu));
        const theirs=el("button","tbx-cfbtn","Usar do servidor: "+valText(fl.servidor));
        fl._choice="meu";
        mine.onclick=()=>{ fl._choice="meu"; mine.classList.add("on"); theirs.classList.remove("on"); };
        theirs.onclick=()=>{ fl._choice="servidor"; theirs.classList.add("on"); mine.classList.remove("on"); };
        opts.appendChild(mine); opts.appendChild(theirs); row.appendChild(opts); box.appendChild(row); });
      const bar=el("div","tbx-cfbar");
      const apply=el("button","tbx-b-save","Aplicar decisao e salvar"); apply.onclick=()=>this.resolveConflict(cf);
      const cancel=el("button","tbx-b-cancel","Cancelar"); cancel.onclick=()=>{ this.edit.conflict=null; this.renderPanel(); };
      bar.appendChild(cancel); bar.appendChild(apply); box.appendChild(bar); return box;
    },
    async resolveConflict(cf){
      // recarrega a versao vigente e reconstroi os patches sobre ela
      let server; try{ server=await this.cloud.tabelas.getRecord(this.selected.id); }catch(e){ this.toast("Falha ao recarregar: "+(e.message||e),"err"); return; }
      const svMap={}; server.campos.forEach(c=>svMap[c.key]={value:c.value,kind:c.kind});
      const contested=new Set(cf.fields.map(f=>f.key));
      const choice={}; cf.fields.forEach(f=>choice[f.key]=f._choice);
      const patches=[];
      cf.originais.forEach(p=>{
        if(contested.has(p.key)){
          if(choice[p.key]==="servidor") return; // aceita o do servidor: sem patch
          patches.push({key:p.key, baseValue:svMap[p.key].value, baseKind:svMap[p.key].kind, value:p.value, kind:p.kind}); // manter o meu sobre a base atual
        } else {
          // campo so meu: reaplica sobre a base atual (servidor)
          patches.push({key:p.key, baseValue:svMap[p.key].value, baseKind:svMap[p.key].kind, value:p.value, kind:p.kind});
        }
      });
      if(!patches.length){ this.selected=server; this.mode="consulta"; this.edit=null; const i=this.rows.findIndex(x=>x.id===server.id); if(i>=0)this.rows[i]=server; this.render(); this.toast("Aplicada a versao do servidor.","ok"); return; }
      let res; try{ res=await this.cloud.tabelas.saveCampos({id:this.selected.id,patches,motivo:"resolucao de conflito"}); }
      catch(e){ if(e&&e.code==="conflict"){ this.edit.conflict={fields:e.fields,originais:patches}; this.renderPanel(); this.toast("Novo conflito. Decida novamente.","warn"); return; } this.toast("Falha ao salvar: "+(e.message||e),"err"); return; }
      this.selected=res.record; this.mode="consulta"; this.edit=null; const i=this.rows.findIndex(x=>x.id===res.record.id); if(i>=0)this.rows[i]=res.record; this.render();
      this.toast("Conflito resolvido e salvo.","ok");
    },

    async renderHist(body,foot){
      const r=this.selected; const g=el("div","tbx-grp"); g.appendChild(el("p","tbx-gt","Historico de alteracoes"));
      let hist=[]; try{ hist=await this.cloud.tabelas.historico(r.id); }catch(e){ hist=[]; }
      if(!hist.length)g.appendChild(el("p","tbx-hint","Sem alteracoes registradas para este registro."));
      hist.forEach(h=>{ const it=el("div","tbx-hist"); it.appendChild(el("div","tbx-hh",h.campo));
        it.appendChild(el("div","tbx-hm",fmtDate(h.criado_em)+"  |  "+(h.usuario||"?")+"  |  v"+h.versao));
        const hv=el("div","tbx-hv"); hv.appendChild(el("span","tbx-old",h.valor_anterior)); hv.appendChild(el("span",null," -> ")); hv.appendChild(el("span","tbx-new",h.valor_novo)); it.appendChild(hv);
        const c=r.campos.find(x=>x.label===h.campo);
        if(c){ const b=el("button","tbx-mini","Recuperar este valor anterior"); b.onclick=()=>this.recover(c,h); const rv=el("div","tbx-rev"); rv.appendChild(b); it.appendChild(rv); }
        g.appendChild(it); });
      body.appendChild(g);
      const back=el("button","tbx-b-cancel","Voltar para a ficha"); back.onclick=()=>{ this.tab="ficha"; this.renderPanel(); }; foot.appendChild(back);
    },
    async recover(c,h){
      if(!confirm('Recuperar "'+h.valor_anterior+'" para "'+h.campo+'"? Cria uma nova alteracao registrada (o historico e preservado).'))return;
      const parsed=parseVal(h.valor_anterior,c); const cur=this.selected.campos.find(x=>x.key===c.key);
      try{ const res=await this.cloud.tabelas.saveCampos({id:this.selected.id,motivo:"recuperacao de valor anterior",patches:[{key:c.key,baseValue:cur.value,baseKind:cur.kind,value:parsed.value,kind:parsed.kind}]});
        if(res&&res.record){ this.selected=res.record; const i=this.rows.findIndex(x=>x.id===res.record.id); if(i>=0)this.rows[i]=res.record; this.render(); this.toast("Valor anterior recuperado.","ok"); } }
      catch(e){ if(e&&e.code==="conflict"){ this.toast("O registro mudou. Abra de novo e tente.","warn"); } else this.toast("Falha: "+(e.message||e),"err"); }
    },

    // ---------- Importacao administrativa (admin) ----------
    wireImport(){
      const ov=this.$(".tbx-imp"), file=this.$(".tbx-imp-file"), btn=this.$(".tbx-imp-btn");
      if(btn) btn.onclick=()=>this.openImport();
      if(this.$(".tbx-imp-x")) this.$(".tbx-imp-x").onclick=()=>this.closeImport();
      if(ov) ov.addEventListener("click",e=>{ if(e.target===ov) this.closeImport(); });
      if(file) file.addEventListener("change",()=>{ const f=file.files&&file.files[0]; if(f) this.onImpFile(f); });
    },
    impAllowed(){ return !!(this.cloud&&this.cloud.isAdmin&&this.cloud.isAdmin()&&this.cloud.importer); },
    openImport(){
      if(!this.impAllowed()){ this.toast("Importacao restrita ao administrador.","err"); return; }
      this.imp={json:null,validation:null,report:null,running:false};
      const ov=this.$(".tbx-imp"); ov.classList.add("on"); ov.setAttribute("aria-hidden","false");
      this.renderImpPick();
    },
    closeImport(){
      if(this.imp&&this.imp.running){ if(!confirm("A importacao esta em andamento. Fechar nao desfaz o que ja foi gravado, mas voce perde o acompanhamento. Fechar mesmo assim?")) return; }
      const ov=this.$(".tbx-imp"); ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");
      const file=this.$(".tbx-imp-file"); if(file) file.value="";
      if(this.imp&&this.imp.report&&(this.imp.report.created>0||this.imp.report.metaWritten)) this.refreshAfterImport();
    },
    renderImpPick(){
      const b=this.$(".tbx-imp-body"), f=this.$(".tbx-imp-foot"); f.innerHTML="";
      const proj=(window.EFA_FIREBASE_CONFIG&&window.EFA_FIREBASE_CONFIG.projectId)||"desconhecido";
      b.innerHTML='<p class="tbx-imp-p">Selecione o arquivo <b>ilikia_seed.json</b> no seu computador. Ele fica apenas no seu navegador: nada e enviado antes de voce validar e confirmar.</p>'+
        '<div class="tbx-imp-proj '+(proj==="efa-comercial"?"ok":"bad")+'">Projeto conectado: <b>'+escapeHtml(proj)+'</b></div>';
      const pick=el("button","tbx-b-save","Selecionar arquivo JSON"); pick.onclick=()=>this.$(".tbx-imp-file").click(); f.appendChild(pick);
      const cancel=el("button","tbx-b-cancel","Fechar"); cancel.onclick=()=>this.closeImport(); f.appendChild(cancel);
    },
    async onImpFile(file){
      const b=this.$(".tbx-imp-body"); b.innerHTML='<div class="tbx-loading"><span class="tbx-spin"></span> Lendo e validando...</div>'; this.$(".tbx-imp-foot").innerHTML="";
      let text; try{ text=await file.text(); }catch(e){ this.renderImpError("Nao consegui ler o arquivo: "+(e.message||e)); return; }
      let json; try{ json=JSON.parse(text); }catch(e){ this.renderImpError("O arquivo nao e um JSON valido: "+(e.message||e)); return; }
      let rep; try{ rep=this.cloud.importer.validate(json); }catch(e){ this.renderImpError("Falha na validacao: "+(e.message||e)); return; }
      this.imp.json=json; this.imp.validation=rep;
      this.renderImpValidation(rep,file.name);
    },
    renderImpValidation(rep,name){
      const b=this.$(".tbx-imp-body"), f=this.$(".tbx-imp-foot"); f.innerHTML="";
      let rows=Object.keys(rep.counts).map(k=>'<tr><td>'+escapeHtml(this.DLABEL[k]||k)+'</td><td class="tbx-num">'+rep.counts[k]+'</td></tr>').join('');
      if(rep.outros) rows+='<tr><td>outras modalidades</td><td class="tbx-num">'+rep.outros+'</td></tr>';
      const projOk=rep.matchesTarget;
      let html='<div class="tbx-imp-proj '+(projOk?"ok":"bad")+'">Projeto conectado: <b>'+escapeHtml(rep.projectId||"desconhecido")+'</b> '+(projOk?"(confere com efa-comercial)":"(NAO e efa-comercial: a importacao fica bloqueada)")+'</div>'+
        '<div class="tbx-imp-fn">Arquivo: '+escapeHtml(name||"")+'</div>'+
        '<table class="tbx-imp-tab"><thead><tr><th>Modalidade</th><th class="tbx-num">Registros</th></tr></thead><tbody>'+rows+
          '<tr class="tbx-imp-tot"><td>Total</td><td class="tbx-num">'+rep.total+'</td></tr></tbody></table>'+
        '<div class="tbx-imp-meta">Metadata (mapa): '+(rep.metaPresent?("presente"+(rep.metaMapUfs?(" - "+rep.metaMapUfs+" UFs"):" (sem mapa.por_uf)")):"ausente")+'</div>';
      if(rep.problems&&rep.problems.length) html+='<div class="tbx-imp-box bad"><b>Impedimentos (corrija antes de importar):</b><ul>'+rep.problems.map(p=>"<li>"+escapeHtml(p)+"</li>").join("")+'</ul></div>';
      if(rep.warnings&&rep.warnings.length) html+='<div class="tbx-imp-box warn"><b>Observacoes:</b><ul>'+rep.warnings.map(p=>"<li>"+escapeHtml(p)+"</li>").join("")+'</ul></div>';
      html+='<div class="tbx-imp-note">A importacao <b>nao sobrescreve</b> registros ja existentes online (edicoes da equipe sao preservadas). Pode rodar de novo: cria so o que falta, sem duplicar.</div>';
      b.innerHTML=html;
      const canRun=rep.ok&&rep.matchesTarget;
      const other=el("button","tbx-b-cancel","Escolher outro arquivo"); other.onclick=()=>this.renderImpPick(); f.appendChild(other);
      const go=el("button","tbx-b-save",canRun?"Importar agora":"Importacao bloqueada"); go.disabled=!canRun; if(canRun) go.onclick=()=>this.runImport(); f.appendChild(go);
      this.maybeShowResume();
    },
    async maybeShowResume(){
      try{ const p=await this.cloud.importer.getProgress();
        if(p&&!p.done&&this.imp&&this.imp.validation&&p.total===this.imp.validation.total&&p.sig===this.imp.validation.sig){
          const n=el("div","tbx-imp-box warn"); n.innerHTML="<b>Retomada:</b> a importacao anterior deste arquivo ficou com pendencias. Importar de novo reavalia o que ja existe online e recria so o que falta, sem duplicar nem sobrescrever.";
          const b=this.$(".tbx-imp-body"); if(b) b.appendChild(n); }
      }catch(e){}
    },
    async runImport(){
      if(!this.imp||!this.imp.json) return;
      this.imp.running=true; this.$(".tbx-imp-foot").innerHTML="";
      this.renderImpProgress({index:0,total:(this.imp.validation&&this.imp.validation.total)||0,created:0,preserved:0,failed:0,phase:"start"});
      let report;
      try{ report=await this.cloud.importer.run(this.imp.json,(st)=>this.renderImpProgress(st)); }
      catch(e){ this.imp.running=false; this.renderImpError("A importacao parou: "+(e.message||e)+(e.problems?(" ("+e.problems.join("; ")+")"):"")); return; }
      this.imp.running=false; this.imp.report=report; this.renderImpResult(report);
    },
    renderImpProgress(st){
      const b=this.$(".tbx-imp-body"); if(!b) return;
      if(st.phase==="scan"){
        b.innerHTML='<div class="tbx-imp-run"><div class="tbx-imp-bar tbx-imp-indet"><i></i></div>'+
          '<div class="tbx-imp-stat">Verificando registros existentes'+(st.scanned?(" ("+st.scanned+")"):"")+'...</div>'+
          '<div class="tbx-imp-note">Conferindo o que ja existe online para criar so o que falta e preservar o resto.</div></div>';
        return;
      }
      const total=st.total||1, done=st.index||0, pct=Math.min(100,Math.round(done/total*100));
      b.innerHTML='<div class="tbx-imp-run"><div class="tbx-imp-bar"><i style="width:'+pct+'%"></i></div>'+
        '<div class="tbx-imp-stat">'+done+' de '+total+' processados ('+pct+'%)</div>'+
        '<div class="tbx-imp-nums">Criados: <b>'+(st.created||0)+'</b> &middot; Preservados: <b>'+(st.preserved||0)+'</b> &middot; Falhas: <b>'+(st.failed||0)+'</b></div>'+
        '<div class="tbx-imp-note">Se fechar ou a conexao cair, rode de novo: ele reavalia o que ja existe e recria so o que falta.</div></div>';
    },
    renderImpResult(report){
      const b=this.$(".tbx-imp-body"), f=this.$(".tbx-imp-foot"); f.innerHTML="";
      let html='<div class="tbx-imp-box '+(report.failed?"warn":"ok")+'"><b>'+(report.failed?"Importacao concluida com pendencias":"Importacao concluida")+'</b></div>'+
        '<div class="tbx-imp-nums">Criados: <b>'+report.created+'</b><br>Preservados (ja existiam online, nao sobrescritos): <b>'+report.preserved+'</b><br>Falhas: <b>'+report.failed+'</b><br>Mapa (ilikia_meta/info): <b>'+(report.metaWritten?"gravado":(report.metaPreserved?"ja existia, preservado":(report.metaFailed?"falhou (use Tentar de novo)":"nao enviado")))+'</b></div>';
      if(report.failures&&report.failures.length) html+='<div class="tbx-imp-box warn"><b>Falhas (ate 50 listadas):</b><ul>'+report.failures.slice(0,50).map(x=>"<li>"+escapeHtml(x.id)+": "+escapeHtml(x.erro)+"</li>").join("")+'</ul><div>Rode de novo para tentar os que faltaram; nada ja gravado e duplicado.</div></div>';
      html+='<div class="tbx-imp-note">Feche para ver os dados na tela; a consulta ja reflete o que foi gravado.</div>';
      b.innerHTML=html;
      const close=el("button","tbx-b-save","Concluir e ver os dados"); close.onclick=()=>this.closeImport(); f.appendChild(close);
      if(report.failed){ const retry=el("button","tbx-b-cancel","Tentar os que faltaram"); retry.onclick=()=>this.runImport(); f.appendChild(retry); }
    },
    renderImpError(msg){
      const b=this.$(".tbx-imp-body"), f=this.$(".tbx-imp-foot"); f.innerHTML="";
      b.innerHTML='<div class="tbx-imp-box bad"><b>Nao deu para seguir</b><div>'+escapeHtml(msg)+'</div></div>';
      const other=el("button","tbx-b-save","Escolher arquivo"); other.onclick=()=>this.renderImpPick(); f.appendChild(other);
      const cancel=el("button","tbx-b-cancel","Fechar"); cancel.onclick=()=>this.closeImport(); f.appendChild(cancel);
    },
    async refreshAfterImport(){
      try{ if(this.cloud) this.meta=await this.cloud.tabelas.getMeta(); }catch(e){}
      this.applyFilters();
    },

    toast(msg,kind){ let t=this.$(".tbx-toast"); t.textContent=msg; t.className="tbx-toast on "+(kind||""); clearTimeout(this._tt); this._tt=setTimeout(()=>t.className="tbx-toast "+(kind||""),3400); }
  };
  function parseVal(txt,c){ if(txt==="(em branco)")return {value:null,kind:"blank"}; if(txt==="0")return {value:0,kind:(/^prazo/.test(c.key)?"int":"zero")}; if(norm(txt)==="sob cotacao")return {value:txt,kind:"cotacao"};
    if(txt.indexOf("R$")===0){ const n=Number(txt.replace("R$","").trim().replace(/\./g,"").replace(",",".")); return {value:n,kind:"money"}; }
    const n=Number(String(txt).replace(/\./g,"").replace(",",".")); if(isFinite(n)&&/^[0-9.,]+$/.test(txt))return {value:/^prazo/.test(c.key)?Math.round(n):n,kind:/^prazo/.test(c.key)?"int":"number"}; return {value:txt,kind:"text"}; }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])); }

  window.EfaTabelas={ open:()=>App.open(), _app:App };

  const SHELL=`
  <div class="tbx-wrap">
    <header class="tbx-hd">
      <span class="tbx-brand"><img class="tbx-logo-efa" alt="EFA"><span class="tbx-dv"></span><img class="tbx-logo-cvs" alt="CVS"></span>
      <nav class="tbx-crumb"><button class="tbx-back">Area Comercial</button><span>/</span><span class="tbx-cur">Tabelas ILIKIA</span></nav>
      <span class="tbx-sp"></span>
      <span class="tbx-user"></span>
    </header>
    <div class="tbx-tb">
      <div class="tbx-fld"><label>Modalidade</label><select class="tbx-f-mod"></select></div>
      <div class="tbx-fld"><label>UF</label><select class="tbx-f-uf"></select></div>
      <div class="tbx-fld"><label>Regiao</label><select class="tbx-f-reg"></select></div>
      <div class="tbx-fld"><label>Classificacao</label><select class="tbx-f-cls"></select></div>
      <div class="tbx-fld tbx-busca"><label>Buscar localidade / cidade</label><input class="tbx-f-busca" type="search" placeholder="Ex.: Porto Alegre" autocomplete="off"></div>
      <button class="tbx-refresh" style="display:none">Ha atualizacoes, recarregar</button>
      <button class="tbx-imp-btn" style="display:none" title="Importar a base ILIKIA (restrito ao administrador)">Importar base</button>
      <div class="tbx-count"></div>
    </div>
    <div class="tbx-content"></div>
  </div>
  <div class="tbx-scrim"></div>
  <aside class="tbx-panel">
    <div class="tbx-phd"><div><div class="tbx-pt"></div><div class="tbx-ps"></div></div><button class="tbx-x" title="Fechar">&times;</button></div>
    <div class="tbx-ptabs"><button class="tbx-tab-ficha on">Ficha</button><button class="tbx-tab-hist">Historico</button></div>
    <div class="tbx-pbody"></div>
    <div class="tbx-pfoot"></div>
  </aside>
  <div class="tbx-toast"></div>
  <div class="tbx-imp" aria-hidden="true">
    <div class="tbx-imp-card">
      <div class="tbx-imp-hd"><b>Importar base ILIKIA</b><button class="tbx-imp-x" title="Fechar">&times;</button></div>
      <div class="tbx-imp-body"></div>
      <div class="tbx-imp-foot"></div>
    </div>
    <input class="tbx-imp-file" type="file" accept=".json,application/json" style="display:none">
  </div>`;

  const STYLE=`
  #tabelasView{position:fixed;inset:0;z-index:180;display:none;background:#F2F5F9;color:#13181F;font-size:14px;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .tbx-wrap{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}
  #tabelasView *{box-sizing:border-box}
  .tbx-hd{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #E2E7EE}
  .tbx-brand{display:flex;align-items:center;gap:10px} .tbx-brand img{height:22px;display:block;object-fit:contain} .tbx-dv{width:1px;height:18px;background:#D3DAE4}
  .tbx-crumb{display:flex;align-items:center;gap:8px;color:#55606D;font-size:12.5px}
  .tbx-back{background:none;border:0;color:#55606D;font-weight:800;cursor:pointer;padding:4px 6px;border-radius:7px}
  .tbx-back:hover{color:#1F6FCC;background:#F6F8FB} .tbx-cur{font-weight:800;color:#123A75}
  .tbx-sp{flex:1} .tbx-user{font-size:12px;color:#55606D;font-weight:700}
  .tbx-tb{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;padding:12px 16px;background:#fff;border-bottom:1px solid #E2E7EE}
  .tbx-fld{display:flex;flex-direction:column;gap:4px;min-width:120px} .tbx-fld label{font-size:10.5px;font-weight:800;color:#8A94A2;text-transform:uppercase;letter-spacing:.04em}
  .tbx-fld select,.tbx-fld input{padding:9px 10px;border:1px solid #E2E7EE;border-radius:9px;background:#fff;color:#13181F;font:inherit}
  .tbx-fld select:focus,.tbx-fld input:focus{outline:none;border-color:#3399FF;box-shadow:0 0 0 3px rgba(51,153,255,.13)}
  .tbx-busca{flex:1;min-width:200px} .tbx-busca input{background:#F6F8FB}
  .tbx-refresh{align-self:center;background:#FBEED0;color:#8A5A00;border:1px solid #EAD9A8;border-radius:999px;padding:6px 12px;font-weight:800;font-size:11.5px;cursor:pointer}
  .tbx-count{margin-left:auto;font-size:12px;color:#55606D;font-weight:700;padding-bottom:9px} .tbx-count b{color:#123A75}
  .tbx-content{flex:1;overflow:auto;padding:14px 16px 40px}
  .tbx-tablewrap{background:#fff;border:1px solid #E2E7EE;border-radius:12px;overflow:auto;box-shadow:0 1px 2px rgba(16,28,48,.06)}
  .tbx-table{width:100%;border-collapse:collapse} .tbx-table thead th{position:sticky;top:0;background:#123A75;color:#fff;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;padding:9px 12px;font-weight:750;white-space:nowrap;z-index:1}
  .tbx-table td{padding:9px 12px;border-top:1px solid #E2E7EE;font-size:13px;vertical-align:middle} .tbx-table tbody tr{cursor:pointer} .tbx-table tbody tr:hover{background:#f2f8ff} .tbx-table tr.tbx-sel{background:#e9f3ff}
  .tbx-loc{font-weight:750;color:#123A75} .tbx-muted{color:#8A94A2}
  .tbx-ds{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:6px;white-space:nowrap;background:#e9f0fb;color:#123A75}
  .tbx-ds-AEREO_CONVENCIONAL{background:#eaf5ff;color:#1F6FCC} .tbx-ds-AEREO_EXPRESSO{background:#eef7f0;color:#16794A} .tbx-ds-CIDADES{background:#f2f0fb;color:#5b45a8} .tbx-ds-PRAZOS{background:#fbf0ea;color:#a85a2a}
  .tbx-v.tbx-num{font-weight:800;color:#123A75;font-variant-numeric:tabular-nums} .tbx-v.tbx-zero{font-weight:800} .tbx-v.tbx-blank{color:#8A94A2;font-style:italic} .tbx-v.tbx-cot{color:#8A5A00;font-weight:800;font-size:11px;background:#FBEED0;padding:1px 7px;border-radius:6px}
  .tbx-un{font-size:10.5px;color:#8A94A2;font-weight:700;margin-left:3px}
  .tbx-more{padding:10px;text-align:center} .tbx-link{background:#F6F8FB;border:1px solid #E2E7EE;border-radius:9px;padding:8px 16px;font-weight:800;color:#1F6FCC;cursor:pointer}
  .tbx-empty{padding:44px 20px;text-align:center;color:#55606D} .tbx-empty b{display:block;font-size:15px;color:#123A75;margin-bottom:4px} .tbx-hint{font-size:11.5px;color:#8A94A2}
  /* matriz expresso */
  .tbx-exphint{font-size:12px;color:#55606D;background:#fff;border:1px solid #E2E7EE;border-radius:10px;padding:10px 12px;margin-bottom:12px}
  .tbx-matrix{table-layout:fixed} .tbx-matrix th,.tbx-matrix td{text-align:center} .tbx-matrix th.tbx-sticky,.tbx-matrix td.tbx-sticky{position:sticky;left:0;text-align:left;z-index:2;width:132px;min-width:132px}
  .tbx-matrix td.tbx-sticky{background:#fff;font-weight:750;color:#123A75} .tbx-matrix thead th.tbx-sticky{background:#123A75;left:0;z-index:3}
  .tbx-matrix .tbx-ufs{font-weight:600;font-size:9px;opacity:.85;margin-top:2px;text-transform:none;letter-spacing:0}
  .tbx-matrix td.tbx-num{font-variant-numeric:tabular-nums;color:#123A75}
  .tbx-colon{background:#eaf5ff!important;color:#1F6FCC!important} th.tbx-colon{background:#0E2A54!important}
  .tbx-coloff{opacity:.45} .tbx-badge{font-size:9px;font-weight:800;background:#FBEED0;color:#8A5A00;border-radius:5px;padding:1px 6px;margin-left:4px}
  /* painel */
  .tbx-scrim{position:absolute;inset:0;background:rgba(9,17,33,.34);z-index:5;opacity:0;pointer-events:none;transition:.16s} .tbx-scrim.on{opacity:1;pointer-events:auto}
  .tbx-panel{position:absolute;top:0;right:0;height:100%;width:min(470px,100%);background:#fff;z-index:6;box-shadow:-12px 0 34px rgba(16,28,48,.16);transform:translateX(102%);transition:transform .2s;display:flex;flex-direction:column}
  .tbx-panel.on{transform:none}
  .tbx-phd{padding:14px 16px;border-bottom:1px solid #E2E7EE;display:flex;align-items:flex-start;gap:10px}
  .tbx-pt{font-size:16px;font-weight:800;color:#123A75} .tbx-ps{font-size:12px;color:#55606D;margin-top:2px}
  .tbx-x{margin-left:auto;background:#F6F8FB;border:1px solid #E2E7EE;border-radius:8px;width:32px;height:32px;font-size:16px;color:#55606D;cursor:pointer}
  .tbx-ptabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid #E2E7EE} .tbx-ptabs button{background:none;border:0;padding:8px 12px;font-weight:800;font-size:12.5px;color:#55606D;border-bottom:2px solid transparent;cursor:pointer} .tbx-ptabs button.on{color:#123A75;border-bottom-color:#ED1C24}
  .tbx-pbody{flex:1;overflow:auto;padding:14px 16px 96px} .tbx-pfoot{border-top:1px solid #E2E7EE;padding:12px 16px;display:flex;gap:8px;align-items:center;background:#fff}
  .tbx-grp{margin-bottom:16px} .tbx-gt{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#8A94A2;margin:0 0 8px}
  .tbx-ident{background:#F6F8FB;border:1px solid #E2E7EE;border-radius:10px;padding:10px 12px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px}
  .tbx-ident dt{font-size:11px;color:#55606D;font-weight:700} .tbx-ident dd{margin:0;font-size:12.5px;color:#13181F;font-weight:700;text-align:right} .tbx-ident dd.tbx-locv{color:#123A75;font-weight:800}
  .tbx-frow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed #E2E7EE} .tbx-frow:last-child{border-bottom:0}
  .tbx-fl{flex:1;font-size:12.5px;color:#55606D;font-weight:600} .tbx-ufline{font-size:10px;color:#8A94A2;font-weight:700;margin-top:2px} .tbx-fv{text-align:right;font-size:13px}
  .tbx-b-edit{background:#123A75;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:800;margin-left:auto;cursor:pointer}
  .tbx-b-save{background:#ED1C24;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer} .tbx-b-save:disabled{opacity:.5;cursor:not-allowed}
  .tbx-b-cancel{background:#F6F8FB;border:1px solid #E2E7EE;border-radius:9px;padding:10px 14px;font-weight:800;color:#123A75;cursor:pointer}
  .tbx-dirty{font-size:11px;color:#8A5A00;font-weight:800;margin-right:auto}
  .tbx-feditrow{padding:11px 0;border-bottom:1px solid #E2E7EE} .tbx-efl{font-size:12px;font-weight:800;color:#123A75;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .tbx-ufmini{font-size:10px;color:#8A94A2;font-weight:700} .tbx-chg{font-size:10px;font-weight:800;color:#1F6FCC;background:#e9f3ff;border-radius:6px;padding:1px 7px}
  .tbx-ec{display:flex;flex-direction:column;gap:5px} .tbx-kinds{display:flex;flex-wrap:wrap;gap:4px} .tbx-kinds button{font-size:10.5px;font-weight:800;border:1px solid #E2E7EE;background:#F6F8FB;color:#55606D;border-radius:7px;padding:3px 8px;cursor:pointer} .tbx-kinds button.on{background:#123A75;color:#fff;border-color:#123A75}
  .tbx-inrow{display:flex;align-items:center;gap:6px} .tbx-prefix{font-size:11px;color:#55606D;font-weight:800} .tbx-num{width:100%;padding:8px 10px;border:1px solid #D3DAE4;border-radius:8px;text-align:right;font:inherit;font-variant-numeric:tabular-nums} .tbx-num:focus{outline:none;border-color:#3399FF;box-shadow:0 0 0 3px rgba(51,153,255,.14)}
  .tbx-ec.changed .tbx-num{border-color:#1F6FCC;background:#f4faff} .tbx-st{font-size:11px;color:#8A94A2} .tbx-inv{color:#B4232A}
  .tbx-diff{background:#f4faff;border:1px solid #cfe6ff;border-radius:10px;padding:10px 12px;margin-bottom:14px} .tbx-difft{font-size:11px;font-weight:800;color:#1F6FCC;text-transform:uppercase;margin-bottom:8px}
  .tbx-dr{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 0} .tbx-k{flex:1;color:#55606D;font-weight:700} .tbx-old{color:#B4232A;text-decoration:line-through;font-weight:700} .tbx-arw{color:#8A94A2} .tbx-new{color:#16794A;font-weight:800}
  .tbx-conflict{background:#FDECEC;border:1px solid #f2c4c4;border-radius:10px;padding:12px;margin-bottom:14px} .tbx-ct{font-weight:800;color:#B4232A;margin-bottom:6px}
  .tbx-cfrow{padding:8px 0;border-top:1px dashed #f2c4c4} .tbx-cflab{font-weight:800;color:#123A75;font-size:12.5px;margin-bottom:5px} .tbx-cfopts{display:flex;flex-wrap:wrap;gap:6px}
  .tbx-cfbtn{font-size:11.5px;font-weight:800;border:1px solid #E2E7EE;background:#fff;border-radius:8px;padding:5px 10px;cursor:pointer} .tbx-cfbtn.on{background:#123A75;color:#fff;border-color:#123A75}
  .tbx-cfbar{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}
  .tbx-offbox{background:#FDF3E2;border:1px solid #EAD9A8;border-radius:10px;padding:12px;margin-bottom:14px}
  .tbx-hist{border-left:2px solid #D3DAE4;padding:2px 0 12px 12px;margin-left:4px;position:relative} .tbx-hist:before{content:'';position:absolute;left:-5px;top:5px;width:8px;height:8px;border-radius:50%;background:#3399FF}
  .tbx-hh{font-size:12px;font-weight:800;color:#123A75} .tbx-hm{font-size:11px;color:#8A94A2} .tbx-hv{font-size:12px;margin-top:3px} .tbx-hv .tbx-old{color:#B4232A;text-decoration:line-through} .tbx-hv .tbx-new{color:#16794A;font-weight:800}
  .tbx-mini{margin-top:5px;background:#F6F8FB;border:1px solid #E2E7EE;border-radius:7px;padding:4px 9px;font-weight:800;font-size:11px;color:#1F6FCC;cursor:pointer}
  .tbx-toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);z-index:9;background:#13181F;color:#fff;padding:11px 16px;border-radius:10px;font-size:13px;font-weight:700;box-shadow:0 10px 34px rgba(16,28,48,.3);opacity:0;pointer-events:none;transition:.2s;max-width:92vw}
  .tbx-toast.on{opacity:1;transform:translateX(-50%)} .tbx-toast.ok{background:#16794A} .tbx-toast.err{background:#B4232A} .tbx-toast.warn{background:#8A5A00}
  /* estados e mapa */
  .tbx-loading{display:flex;align-items:center;gap:10px;justify-content:center;padding:48px 20px;color:#55606D;font-weight:700}
  .tbx-spin{width:18px;height:18px;border:2px solid #CcD6E4;border-top-color:#123A75;border-radius:50%;display:inline-block;animation:tbxspin .7s linear infinite}
  @keyframes tbxspin{to{transform:rotate(360deg)}}
  .tbx-mapwrap{background:#fff;border:1px solid #E2E7EE;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(16,28,48,.06)}
  .tbx-maptop{margin-bottom:10px} .tbx-maptitle{font-size:15px;font-weight:800;color:#123A75} .tbx-mapnote{font-size:12px;color:#55606D;margin-top:3px;max-width:640px}
  .tbx-mapgrid{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:18px;align-items:start}
  .tbx-mapsvg{position:relative;min-width:0} .tbx-mapsvg svg{width:100%;height:auto;display:block;max-height:68vh}
  .tbx-uf{stroke:#fff;stroke-width:1;cursor:pointer;transition:opacity .1s} .tbx-uf:hover{opacity:.82;stroke:#123A75;stroke-width:1.4}
  .tbx-uflab{font:700 11px -apple-system,system-ui,sans-serif;pointer-events:none}
  .tbx-maptip{position:absolute;display:none;background:#13181F;color:#fff;font-size:12px;padding:7px 10px;border-radius:8px;pointer-events:none;z-index:4;box-shadow:0 6px 20px rgba(16,28,48,.3);white-space:nowrap}
  .tbx-mapside{display:flex;flex-direction:column;gap:12px}
  .tbx-lg{display:flex;flex-direction:column;gap:7px;font-size:12px;color:#55606D} .tbx-lgi{display:flex;align-items:center} .tbx-lgi i{display:inline-block;width:16px;height:12px;border-radius:3px;margin-right:7px}
  .tbx-maplimit{font-size:11px;color:#8A94A2;line-height:1.5;border-top:1px solid #E2E7EE;padding-top:10px}
  .tbx-mapsrc{font-size:10.5px;color:#8A94A2;margin-top:10px;text-align:right}
  @media (max-width:640px){ .tbx-panel{width:100%} .tbx-fld{min-width:calc(50% - 5px)} .tbx-busca{min-width:100%} .tbx-count{margin-left:0;width:100%}
    .tbx-table th:nth-child(3),.tbx-table td:nth-child(3),.tbx-table th:nth-child(4),.tbx-table td:nth-child(4){display:none} .tbx-user{display:none}
    .tbx-mapgrid{grid-template-columns:1fr} .tbx-lg{flex-direction:row;flex-wrap:wrap;gap:10px} }
  /* importacao (admin) */
  .tbx-imp-btn{background:#123A75;border:1px solid #123A75;color:#fff;font-weight:800;font-size:12.5px;padding:7px 12px;border-radius:8px;cursor:pointer}
  .tbx-imp-btn:hover{background:#0E2E5E}
  .tbx-imp{position:absolute;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(16,28,48,.5);padding:18px}
  .tbx-imp.on{display:flex}
  .tbx-imp-card{background:#fff;border-radius:14px;width:560px;max-width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(16,28,48,.4)}
  .tbx-imp-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #E2E7EE;font-size:15px;color:#123A75}
  .tbx-imp-x{background:none;border:0;font-size:22px;line-height:1;color:#8A94A2;cursor:pointer}
  .tbx-imp-body{padding:16px 18px;overflow:auto}
  .tbx-imp-foot{padding:12px 18px;border-top:1px solid #E2E7EE;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
  .tbx-imp-p{margin:0 0 12px;color:#55606D;line-height:1.5}
  .tbx-imp-proj{font-size:12.5px;padding:8px 10px;border-radius:8px;margin-bottom:10px;background:#F6F8FB;border:1px solid #E2E7EE}
  .tbx-imp-proj.ok{background:#EAF6EF;border-color:#BFE3CE;color:#16794A} .tbx-imp-proj.bad{background:#FBEBEC;border-color:#F0C4C7;color:#B4232A}
  .tbx-imp-fn{font-size:12px;color:#8A94A2;margin-bottom:8px}
  .tbx-imp-tab{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px}
  .tbx-imp-tab th,.tbx-imp-tab td{border-bottom:1px solid #EEF1F6;padding:6px 8px;text-align:left} .tbx-imp-tab .tbx-num{text-align:right;font-variant-numeric:tabular-nums}
  .tbx-imp-tab thead th{color:#55606D;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  .tbx-imp-tot td{font-weight:800;color:#123A75;border-top:2px solid #E2E7EE}
  .tbx-imp-meta{font-size:12.5px;color:#55606D;margin-bottom:10px}
  .tbx-imp-box{border-radius:9px;padding:10px 12px;margin:10px 0;font-size:12.5px;line-height:1.5} .tbx-imp-box ul{margin:6px 0 0;padding-left:18px}
  .tbx-imp-box.ok{background:#EAF6EF;border:1px solid #BFE3CE;color:#16794A} .tbx-imp-box.warn{background:#FDF3E2;border:1px solid #EAD9A8;color:#8A5A00} .tbx-imp-box.bad{background:#FBEBEC;border:1px solid #F0C4C7;color:#B4232A}
  .tbx-imp-note{font-size:11.5px;color:#8A94A2;line-height:1.5;margin-top:8px}
  .tbx-imp-run{padding:8px 0}
  .tbx-imp-bar{height:12px;background:#EEF1F6;border-radius:7px;overflow:hidden;margin-bottom:10px} .tbx-imp-bar i{display:block;height:100%;background:#2E6DB4;transition:width .2s}
  .tbx-imp-indet i{width:40%;animation:tbxindet 1.1s ease-in-out infinite} @keyframes tbxindet{0%{margin-left:-40%}100%{margin-left:100%}}
  .tbx-imp-stat{font-weight:800;color:#123A75;font-size:14px} .tbx-imp-nums{font-size:12.5px;color:#55606D;margin-top:6px}
  @media (max-width:640px){ .tbx-imp-card{width:100%} }
  `;
})();
