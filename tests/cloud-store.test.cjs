const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,split}=require('../site/cloud-store.js');
function fake(){
  const data=new Map();let fail=false;
  const snap=path=>({id:path.split('/').at(-1),exists:()=>data.has(path),data:()=>structuredClone(data.get(path))});
  return {data,setFail:value=>fail=value,api:{
    doc:(_, ...parts)=>parts.join('/'),collection:(_, ...parts)=>parts.join('/'),serverTimestamp:()=>123,
    getDocsFromServer:async prefix=>({docs:[...data.keys()].filter(k=>k.startsWith(prefix+'/')&&k.split('/').length===2).map(snap)}),
    runTransaction:async(_,fn)=>{
      const writes=[];
      const out=await fn({get:async p=>snap(p),set:(p,v)=>writes.push(()=>data.set(p,structuredClone(v))),delete:p=>writes.push(()=>data.delete(p))});
      if(fail)throw Object.assign(Error('network'),{code:'unavailable'});
      writes.forEach(f=>f());return out;
    }
  }};
}
const initial=()=>({base:{efa:{endereco:'Rua de teste'},tarifas:[]},proposals:{p1:{id:'p1',meta:{titulo:'Proposta'},cliente:{nomeComercial:'Teste'},tarifas:[]}}});
test('primeiro salvamento, leitura em outra sessão e modelo-base',async()=>{
  const f=fake(),a=create(f.api,{});assert.deepEqual(await a.load(),{base:null,proposals:{}});
  await a.save(initial());const b=create(f.api,{});assert.deepEqual(await b.load(),initial());
});
test('imagem maior que um documento é preservada em partes',async()=>{
  const f=fake(),a=create(f.api,{}),value=initial();value.proposals.p1.apresentacao={qr:{type:'custom',data:'data:image/png;base64,'+'A'.repeat(1300000)}};
  await a.save(value);assert.ok(f.data.get('comercial/p_p1').parts>1);
  assert.deepEqual(await create(f.api,{}).load(),value);
});
test('falha de gravação não confirma nem muda o estado salvo',async()=>{
  const f=fake(),a=create(f.api,{});await a.save(initial());const edited=initial();edited.base.efa.endereco='Outro';
  f.setFail(true);await assert.rejects(a.save(edited));assert.deepEqual(a.snapshot(),initial());
});
test('edição concorrente não sobrescreve a versão do outro computador',async()=>{
  const f=fake(),a=create(f.api,{});await a.save(initial());const b=create(f.api,{});await b.load();
  const one=initial();one.proposals.p1.meta.titulo='Computador 1';await a.save(one);
  const two=initial();two.proposals.p1.meta.titulo='Computador 2';await assert.rejects(b.save(two),{code:'conflict'});
  assert.deepEqual(await create(f.api,{}).load(),one);
});
test('registro novo de outra sessão não é apagado por uma edição independente',async()=>{
  const f=fake(),a=create(f.api,{});await a.save(initial());const b=create(f.api,{});await b.load();
  const one=initial();one.proposals.p2={...one.proposals.p1,id:'p2'};await a.save(one);
  const two=initial();two.base.efa.endereco='Modelo alterado';await b.save(two);
  const got=await create(f.api,{}).load();assert.ok(got.proposals.p2);assert.equal(got.base.efa.endereco,'Modelo alterado');
});
test('exclusão remove manifesto e partes; falha preserva tudo',async()=>{
  const f=fake(),a=create(f.api,{});await a.save(initial());const next=initial();next.proposals={};
  f.setFail(true);await assert.rejects(a.save(next));assert.ok(f.data.has('comercial/p_p1'));
  f.setFail(false);await a.save(next);assert.equal([...f.data.keys()].some(k=>k.startsWith('comercial/p_p1')),false);
});
test('reduzir imagens remove partes antigas',async()=>{
  const f=fake(),a=create(f.api,{}),value=initial();value.proposals.p1.image='a'.repeat(600000);await a.save(value);
  await a.save(initial());assert.equal([...f.data.keys()].filter(k=>k.startsWith('comercial/p_p1/partes/')).length,1);
});
test('dados incompletos não são substituídos por valores iniciais',async()=>{
  const f=fake(),a=create(f.api,{});await a.save(initial());f.data.delete('comercial/p_p1/partes/0');
  await assert.rejects(create(f.api,{}).load(),{code:'invalid-data'});
});
test('limite de tamanho falha antes de qualquer gravação',async()=>{
  const f=fake(),a=create(f.api,{}),value=initial();value.proposals.p1.image='a'.repeat(7*1024*1024);
  await assert.rejects(a.save(value),{code:'too-large'});assert.equal(f.data.size,0);
});
test('separação das partes preserva caracteres Unicode',()=>{
  const text='x'.repeat(179999)+'😀'+'á'.repeat(300000);const chunks=split(text);
  assert.equal(chunks.join(''),text);assert.ok(chunks.every(c=>!/[\uD800-\uDBFF]$/.test(c)));
});
