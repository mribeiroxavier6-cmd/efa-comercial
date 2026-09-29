(function(root){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const encode=value=>JSON.stringify(value);
  const MAX_BYTES=6*1024*1024, CHUNK_CHARS=180000;
  function error(code,message){return Object.assign(new Error(message),{code});}
  function split(text){
    const chunks=[];
    for(let start=0;start<text.length;){
      let end=Math.min(text.length,start+CHUNK_CHARS);
      if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]))end--;
      chunks.push(text.slice(start,end));start=end;
    }
    return chunks;
  }
  function records(state){
    const out={base:state.base};
    for(const [id,value] of Object.entries(state.proposals)){
      if(!/^[a-zA-Z0-9_-]+$/.test(id))throw error('invalid-data','Identificação de proposta inválida.');
      out['p_'+id]=value;
    }
    return out;
  }
  function create(api,db){
    let versions={}, baseline={base:null,proposals:{}};
    const ref=id=>api.doc(db,'comercial',id);
    const part=(id,index)=>api.doc(db,'comercial',id,'partes',String(index));
    function check(meta){
      if(meta.format!==1 || !Number.isInteger(meta.parts) || meta.parts<1 || meta.parts>40 || typeof meta.revision!=='string')
        throw error('invalid-data','Não foi possível interpretar os dados online. Nenhum dado foi substituído.');
    }
    async function read(id){
      return api.runTransaction(db,async tx=>{
        const head=await tx.get(ref(id));if(!head.exists())return null;
        const meta=head.data();check(meta);
        const chunks=await Promise.all(Array.from({length:meta.parts},(_,i)=>tx.get(part(id,i))));
        if(chunks.some(d=>!d.exists()||d.data().revision!==meta.revision||typeof d.data().text!=='string'))
          throw error('invalid-data','Proposta incompleta no banco. Nada foi sobrescrito.');
        return {value:JSON.parse(chunks.map(d=>d.data().text).join('')),revision:meta.revision};
      });
    }
    return {
      snapshot:()=>copy(baseline),
      async load(){
        const docs=await api.getDocsFromServer(api.collection(db,'comercial'));
        const result={base:null,proposals:{}}, nextVersions={};
        for(const d of docs.docs){
          if(d.id!=='base'&&!d.id.startsWith('p_'))continue;
          const record=await read(d.id);if(!record)continue;
          if(d.id==='base')result.base=record.value;
          else{
            const id=d.id.slice(2);
            if(record.value.id!==id || !record.value.meta || !record.value.cliente || !Array.isArray(record.value.tarifas))
              throw error('invalid-data','Uma proposta online tem formato inválido. Nenhum dado foi substituído.');
            result.proposals[id]=record.value;
          }
          nextVersions[d.id]=record.revision;
        }
        if(result.base && (!result.base.efa || !Array.isArray(result.base.tarifas)))throw error('invalid-data','Modelo-base online inválido.');
        versions=nextVersions;baseline=copy(result);return copy(result);
      },
      async save(state){
        const next=copy(state), before=records(baseline), after=records(next);
        const changes=Object.keys(after).filter(id=>encode(after[id])!==encode(before[id]));
        const removed=Object.keys(before).filter(id=>before[id] && !(id in after));
        if(!changes.length&&!removed.length)return;
        const payloads=Object.fromEntries(changes.map(id=>[id,split(encode(after[id]))]));
        const bytes=changes.reduce((n,id)=>n+new TextEncoder().encode(encode(after[id])).length,0);
        if(bytes>MAX_BYTES)throw error('too-large','As imagens desta gravação excedem o limite. Reduza as imagens e tente novamente. Os dados continuam na tela.');
        const revision=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
        await api.runTransaction(db,async tx=>{
          const ids=[...changes,...removed], heads=await Promise.all(ids.map(id=>tx.get(ref(id))));
          heads.forEach((snap,i)=>{
            const expected=versions[ids[i]]||null, actual=snap.exists()?snap.data().revision:null;
            if(actual!==expected)throw error('conflict','Este registro foi alterado em outro acesso. Exporte sua edição em JSON antes de recarregar e comparar as versões.');
            if(snap.exists())check(snap.data());
          });
          ids.forEach((id,i)=>{
            const oldParts=heads[i].exists()?heads[i].data().parts:0;
            const chunks=payloads[id]||[];
            chunks.forEach((text,index)=>tx.set(part(id,index),{revision,text}));
            for(let index=chunks.length;index<oldParts;index++)tx.delete(part(id,index));
            if(chunks.length)tx.set(ref(id),{format:1,revision,parts:chunks.length,updatedAt:api.serverTimestamp()});
            else tx.delete(ref(id));
          });
        });
        changes.forEach(id=>versions[id]=revision);removed.forEach(id=>delete versions[id]);baseline=next;
      }
    };
  }
  const exported={create,split,records};
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  else root.EfaCloudStore=exported;
})(typeof window!=='undefined'?window:globalThis);
