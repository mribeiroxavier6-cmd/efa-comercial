(function(){
  'use strict';
  let ready;
  window.getEfaCloud=()=>{
    if(!ready)ready=connect().catch(e=>{ready=null;throw e;});
    return ready;
  };
  async function connect(){
    const [appApi,authApi,dbApi]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')
    ]);
    const app=appApi.initializeApp(window.EFA_FIREBASE_CONFIG);
    const auth=authApi.getAuth(app), db=dbApi.getFirestore(app);
    // Não persistir credenciais ou sessões entre abas. O rascunho permanece apenas em memória.
    await authApi.setPersistence(auth,authApi.inMemoryPersistence);
    const repository=window.EfaCloudStore.create(dbApi,db);
    const tabelas=window.EfaTabelasStore.create(dbApi,db);
    const account=window.EFA_ACCOUNT;
    // Importador administrativo (grava pelo navegador; a restricao efetiva e das regras do Firestore).
    const importer=window.EfaTabelasImport
      ? window.EfaTabelasImport.create(dbApi,db,{projectId:(window.EFA_FIREBASE_CONFIG&&window.EFA_FIREBASE_CONFIG.projectId)||null})
      : null;
    // Tabelas usa a MESMA autenticacao. A autorizacao efetiva (quais contas) e das regras do Firestore.
    function requireAuth(){ if(!auth.currentUser)throw Object.assign(new Error('Entre novamente para continuar.'),{code:'auth/unauthorized'}); }
    // Admin = conta autorizada a importar. A regra do Firestore e quem garante; aqui so decide o que a UI oferece.
    const isAdmin=()=>!!(auth.currentUser && auth.currentUser.uid===account.uid);
    function requireAdmin(){ if(!isAdmin())throw Object.assign(new Error('Acao restrita ao administrador.'),{code:'auth/forbidden'}); }
    const importerApi = importer ? {
      validate:json=>importer.validate(json),
      run:(json,onProgress)=>{ requireAdmin(); return importer.run(json,onProgress); },
      getProgress:()=>{ requireAdmin(); return importer.getProgress(); }
    } : null;
    const tabelasApi={
      queryPage:p=>{requireAuth();return tabelas.queryPage(p);},
      getRecord:id=>{requireAuth();return tabelas.getRecord(id);},
      getMeta:()=>{requireAuth();return tabelas.getMeta();},
      historico:id=>{requireAuth();return tabelas.historico(id);},
      saveCampos:i=>{requireAuth();return tabelas.saveCampos(Object.assign({usuario:(auth.currentUser&&auth.currentUser.email)||null},i));},
      subscribeRecord:(id,cb)=>{requireAuth();return tabelas.subscribeRecord(id,cb);},
      subscribeQuery:(p,cb)=>{requireAuth();return tabelas.subscribeQuery(p,cb);}
    };
    function requireAccount(){
      if(!auth.currentUser||auth.currentUser.uid!==account.uid)throw Object.assign(new Error('Entre novamente para continuar.'),{code:'auth/unauthorized'});
    }
    return {
      async login(username,password){
        if(username.trim().toLowerCase()!==account.username)throw Object.assign(new Error('Usuário ou senha inválidos.'),{code:'auth/invalid-credential'});
        const result=await authApi.signInWithEmailAndPassword(auth,account.email,password);
        if(result.user.uid!==account.uid){await authApi.signOut(auth);throw Object.assign(new Error('Conta sem autorização.'),{code:'auth/unauthorized'});}
      },
      logout:()=>authApi.signOut(auth),
      load:()=>{requireAccount();return repository.load();},
      save:state=>{requireAccount();return repository.save(state);},
      snapshot:()=>repository.snapshot(),
      tabelas:tabelasApi,
      isAdmin,
      importer:importerApi,
      currentUserEmail:()=>auth.currentUser?auth.currentUser.email:null
    };
  }
})();
