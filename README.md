# Área Comercial EFA + CVS

Versão preparada para Firebase Authentication, Cloud Firestore e Netlify.

## Situação desta entrega

- Integração escrita, ainda não publicada nem validada com a conta real.
- Os arquivos recebidos na pasta COMERCIAL foram preservados.
- O código de apresentação e os estilos da versão aprovada foram mantidos.
- Usuário na tela: Eduardo. A senha é validada pelo Firebase; não está no código.
- O salvamento online substitui o armazenamento local nesta versão.
- Backup completo e recuperação foram adiados pelo responsável pelo projeto.

## O que colocar no GitHub

Use esta pasta `area-comercial` como raiz de um repositório privado. Não envie a pasta COMERCIAL inteira.

O `.gitignore` exclui dados-iniciais, arquivos exportados, PDFs, ZIPs e credenciais administrativas. Antes de enviar, confira a seleção de arquivos. O código contém o catálogo comercial padrão; a conta Firebase e o UID configurados são identificadores públicos, não senhas.

## Estrutura

- `site/`: única pasta publicada pela Netlify.
- `netlify.toml`: publica `site`, sem etapa de compilação.
- `firestore.rules`: cópia das regras já publicadas pelo usuário; este arquivo não é publicado automaticamente no Firebase.
- `tests/`: testes locais com serviço simulado. Não alteram o banco real.
- `dados-iniciais/`: referência FFW em JSON, preservada localmente e ignorada pelo Git. Não publicar.

## Firebase configurado

- Projeto: efa-comercial.
- Banco: (default).
- Login: Authentication, provedor E-mail/senha.
- Conta permitida: UID configurado em `site/firebase-config.js` e `firestore.rules`.
- Dados: coleção `comercial`, registro `base` e registros `p_<identificador>`.
- Cada registro usa uma subcoleção `partes`, para preservar imagens sem ultrapassar o limite de um único documento do Firestore.

O SDK oficial é carregado pelo navegador a partir de gstatic.com. Não é necessário instalar dependências para a hospedagem. A versão online requer internet e deve ser servida por HTTP/HTTPS.

## Publicação na Netlify

1. Envie os arquivos desta pasta ao repositório privado correto do GitHub.
2. Na Netlify, escolha importar projeto existente pelo GitHub.
3. Autorize somente o repositório necessário e selecione-o.
4. Mantenha diretório-base vazio se esta pasta for a raiz do repositório.
5. Não configure comando de build. Diretório de publicação: `site`.
6. Confira o `netlify.toml` antes de publicar.
7. Anote a URL criada.
8. No Firebase, Authentication > Configurações > Domínios autorizados, adicione o domínio do site, sem https:// e sem caminho. Faça o mesmo quando configurar o domínio definitivo.

A publicação do HTML não importa dados da versão local. Não envie arquivos de clientes ao repositório. Use o Importar da aplicação após autenticar e clique em Salvar.

## Primeiro acesso e conferência obrigatória

1. Entre com Eduardo e a senha cadastrada no Authentication.
2. Abra Propostas comerciais. Se o banco estiver vazio, haverá uma proposta inicial sem cliente, com os preços aprovados. Clique em Salvar para gravar a proposta e o modelo-base.
3. Para continuar a referência FFW, importe o JSON local de dados-iniciais e salve. Os demais JSONs já exportados podem ser importados individualmente.
4. Modifique uma proposta e aguarde a confirmação “Salvo online”.
5. Entre em outro navegador e confira se a proposta abre com os mesmos dados.
6. Confira as imagens, o QR e o PDF comercial e de revisão.
7. Teste senha incorreta e, no simulador das regras do Firebase, acesso sem autenticação e com outro UID. Ambos devem ser negados.
8. Teste uma falha de conexão: não pode haver confirmação de sucesso nem perda do rascunho.

## Limites e comportamento

- Cada clique em Salvar transmite os registros alterados e só confirma depois da transação no servidor.
- Registros alterados em outro acesso não são sobrescritos silenciosamente. O sistema apresenta conflito e preserva a edição na tela.
- O botão Abrir atualiza a lista online após tratar edições pendentes. Não há atualização automática contínua entre computadores.
- Em falha de conexão, os dados ficam apenas na aba. Não feche nem recarregue antes de salvar ou exportar a proposta.
- O login expira após 20 minutos sem atividade. Reautenticar na mesma aba preserva o rascunho. Recarregar a página exige novo login.
- Para evitar exceder os limites de transação, a aplicação recusa uma gravação com mais de 6 MiB de dados alterados e orienta reduzir imagens; não remove dados silenciosamente.
- A exportação continua sendo de uma proposta, não do banco inteiro.
- A tela de login controla o acesso aos dados online. Recursos estáticos e o catálogo inicial podem ser baixados por quem possui a URL do site.

## Testes e limitações desta entrega

Comando: `npm test` ou `node --test tests/cloud-store.test.cjs tests/app.test.cjs`.

Os testes foram preparados para falhas de gravação, imagens grandes, exclusão, conflitos entre acessos e preservação de layout. A execução foi impedida pelo ambiente e a permissão solicitada foi recusada. Portanto, não há resultado aprovado de execução nesta entrega.

Não houve teste de login real, gravação no Firebase, publicação na Netlify ou inspeção visual do PDF nesta etapa. Esses itens precisam de validação antes da entrega ao Eduardo.
