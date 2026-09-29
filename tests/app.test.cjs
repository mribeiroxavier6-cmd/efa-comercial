const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
function app(){
  const nodes=new Map();
  function node(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',style:{},dataset:{},classList:{add(){},remove(){},contains(){return false;},toggle(){}},addEventListener(){},querySelectorAll(){return[];},focus(){},textContent:'',innerHTML:''});return nodes.get(selector);}
  const context={console,TextEncoder,URL,Blob,Date,JSON,Math,Map,Promise,setTimeout:()=>1,clearTimeout(){},setInterval(){},confirm:()=>true,
    document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},body:node('body')},
    window:{addEventListener(){},innerWidth:1440}};
  vm.createContext(context);for(const s of inline)vm.runInContext(s,context);
  return {context,nodes,run:s=>vm.runInContext(s,context)};
}
test('scripts possuem sintaxe válida e versão online não contém login simulado',()=>{
  for(const s of inline)new vm.Script(s);
  assert.doesNotMatch(html,/CRED_HASH|localStorage|sessionStorage|efa@2026|efa2026/);
  for(const file of ['firebase-config.js','firebase-service.js','cloud-store.js'])new vm.Script(fs.readFileSync(path.join(__dirname,'../site',file),'utf8'));
});
test('falha ao salvar preserva edição e impede Salvar e continuar',async()=>{
  const a=app();a.run("cloud={save:async()=>{throw Object.assign(Error('offline'),{code:'unavailable'});}};store={base:{},proposals:{}};setDirty(true);pendingConfirm=()=>{window.continued=true;};");
  await a.context.window.saveAndGo();assert.equal(a.run('dirty'),true);assert.notEqual(a.context.window.continued,true);
  assert.match(a.nodes.get('#toast').textContent,/Não foi possível/);
});
test('sucesso só ocorre depois da confirmação remota',async()=>{
  const a=app();a.run("let release;cloud={save:()=>new Promise(r=>release=r)};store={base:{},proposals:{}};setDirty(true);");
  const pending=a.run('saveOnline()');assert.equal(a.nodes.get('#dirtyFlag').textContent,'Salvando...');assert.equal(a.run('dirty'),true);
  a.run('release()');await pending;assert.equal(a.run('dirty'),false);assert.equal(a.nodes.get('#toast').textContent,'Salvo online.');
});
test('sair com alterações passa pela confirmação; falha não encerra sessão',async()=>{
  const a=app();a.run("let exited=false;cloud={save:async()=>{throw Error('offline')},logout:async()=>{exited=true;}};store={base:{},proposals:{}};setDirty(true);doLogout();");
  assert.match(a.nodes.get('#modalHost').innerHTML,/Salvar e continuar/);
  await a.context.window.saveAndGo();assert.equal(a.run('exited'),false);assert.equal(a.run('dirty'),true);
});
test('atualização pendente durante o salvamento não é marcada como salva',async()=>{
  const a=app();a.run("let release;cloud={save:()=>new Promise(r=>release=r)};store={base:{value:1},proposals:{}};setDirty(true);");
  const pending=a.run('saveOnline()');a.run('store.base.value=2;release()');await pending;assert.equal(a.run('dirty'),true);
});
test('renderização e CSS da apresentação permanecem iguais à versão aprovada',()=>{
  const baseline=require('./layout-baseline.json');
  const sha=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
  assert.equal(sha(html.match(/<style>([\s\S]*?)<\/style>/)[1]),baseline.css);
  const section=s=>s.slice(s.indexOf('/* ================= PREVIEW ================= */'),s.indexOf('function markChanged('));
  assert.equal(sha(section(html)),baseline.preview);
});
