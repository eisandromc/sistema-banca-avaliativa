# Roteiro de testes manuais

Este roteiro serve para conferir o sistema pela interface, com a **Banca de Cenários de Teste — DEMONSTRAÇÃO**. Essa banca é criada automaticamente fora de produção e traz **um grupo em cada situação do processo**. Todos os dados são **fictícios**, e todas as contas usam a senha `demo1234`.

Os cenários são produzidos pelos próprios serviços do sistema (cronômetro, fichas, fechamento, reabertura e exceções), com as mesmas regras e a mesma auditoria do uso real. Eles existem só no ambiente TESTE (`AMBIENTE=TESTE`). Para recriá-los do zero, apague a pasta `.data/pglite-teste` com o servidor parado; isso apaga **todos** os dados do ambiente TESTE.

## Contas

| Conta | Papel nos cenários |
| --- | --- |
| `admin@demo.banca` | Administrador: exceções, reabertura e configuração |
| `ana@demo.banca` | Professora primária do "Dia de cenários": conduz o tempo, avalia e fecha |
| `bruno@demo.banca` | Avaliador (Técnica) |
| `carla@demo.banca` | Avaliadora (Comunicação) |
| `fabio@demo.banca` | Avaliador extra, **só do grupo C-06** (atribuição específica do grupo) |
| `telao@demo.banca` | Somente visualização do cronômetro |

## Grupos do "Dia de cenários"

| Grupo | Situação | O que testar |
| --- | --- | --- |
| C-01 | Finalizado | O PDF da versão 1. O cronômetro foi reiniciado uma vez ("Projetor desligou"), e isso aparece em Acompanhamento › Eventos do cronômetro. Tentar "Reiniciar" com o grupo fechado é recusado. |
| C-02 | Finalizado com exceções | Carla foi dispensada (ausente) e não conta no resultado. O critério "Organização" foi dispensado para Bruno. As duas exceções saem no PDF. |
| C-03 | Fechado, reaberto e fechado de novo (versão 2) | O histórico mostra v1 (reaberta, com o motivo) e v2. O PDF baixa as duas versões. |
| C-04 | Reaberto, aguardando correção | As fichas voltaram a rascunho. Os avaliadores reenviam e a primária fecha a versão 2. |
| C-05 | Aguardando fechamento | Tempo ajustado durante a apresentação. A votação ficou **empatada** (Indicar × Não indicar, com uma abstenção). Pode ser fechado. |
| C-06 | Iniciado com pendências | Ana enviou; Bruno tem rascunho incompleto; Carla e Fábio não preencheram. O fechamento é bloqueado e lista as pendências de cada um. |
| C-07 | Em andamento (pausado) | Grupo atual. O telão mostra "Pausado". O fechamento é bloqueado até encerrar o cronômetro. Não é possível iniciar outro grupo enquanto este estiver ativo. |
| C-08 | Aguardando apresentação | Fluxo normal: selecionar, iniciar, avaliar, encerrar e fechar. |
| C-09 | Fora do cronograma | Aparece como "atenção" no roteiro de preparação. |
| C-10 | No "Dia 2 — preparação incompleta" | O dia está sem primário, sem perfil de tempo e sem avaliadores. O roteiro aponta os três itens como pendentes. |

## Roteiros sugeridos

1. **Tela inicial e acessos**
   - Abra `/`: aparecem só os três cartões.
   - Clique em **Professor** sem estar conectado: o sistema leva ao login e, depois de entrar, à área do professor.
   - A marca "Gestão de Bancas", no topo, volta à tela inicial.
2. **Telão**
   - Abra **Cronômetro** numa janela: sem seleção, ele mostra "Aguardando".
   - Como Ana, no "Dia de cenários", clique em **Ativar no telão**: o telão troca sozinho e mostra o C-07 pausado.
   - Encerre o C-07 e selecione o C-08: o telão volta a "Aguardando". Clique em **Iniciar apresentação**: o telão e as telas dos professores contam de 10 até 0, e então o C-08 aparece com o tempo correndo.
   - Clique uma vez na tela do telão para liberar o som. Ao estourar o tempo, toca o som de palmas. O perfil "Teste rápido" dura 4 minutos.
   - O telão ocupa o monitor inteiro, sem cabeçalho.
   - Fique 3 segundos sem mexer: a barra de cima some. Mexa o mouse ou tecle Tab para ela voltar.
   - Marque "Sem piscar" e confira que o fim do tempo não pisca.
3. **Condução (Ana)**
   - Em **Professor**, escolha "Dia de cenários". O C-07 está pausado.
   - Clique em **Retomar**, depois **Encerrar apresentação**, e selecione o C-08.
   - Clique em **Iniciar apresentação**: as fichas abrem em tempo real para Bruno e Carla, em outra janela.
   - Teste **Avançar etapa**, **Ajustar tempos** (com justificativa) e **Reiniciar**.
4. **Avaliação (Bruno/Carla)**
   - Preencha notas, incluindo zero, que é uma nota válida.
   - Deixe um critério obrigatório vazio e veja a pendência.
   - Vote, envie, e tente editar depois do envio (a política padrão bloqueia).
5. **Fechamento (Ana)**
   - **Conferência** do C-05: feche e baixe o PDF.
   - Tente o C-06: o fechamento fica bloqueado, com a lista de pendências.
   - Volte ao C-04 depois do reenvio dos avaliadores e feche a versão 2.
6. **Exceções e reabertura (admin)**
   - Em **Configuração › Conferência e fechamento**, registre uma dispensa no C-06, para o Fábio, e feche.
   - Reabra um grupo fechado com motivo (mínimo de 10 caracteres) e confira o histórico.
7. **Roteiro de preparação (admin)**
   - Em **Configuração › Visão geral**, com a banca de cenários selecionada, confira as pendências do Dia 2.
   - Use **Resolver** para ir direto à seção certa.
   - Designe o primário, o perfil e os avaliadores do Dia 2, e clique em **Atualizar**: os itens ficam prontos.
8. **Auditoria:** confira que cada ação acima aparece em **Configuração › Auditoria**.
9. **Materiais do projeto e espera do avaliador**
   - Como Bruno, abra o "Dia 1" da "Banca de Projetos — DEMONSTRAÇÃO" antes de a Ana iniciar: aparece **Aguardando o professor primário**, com a lista do dia em ordem (#, hora programada, cor do grupo).
   - Clique em **Projeto** no Grupo 01: o modal mostra resumo, orientadores, alunos e materiais. **Ver apresentação** e **Ler PDF** abrem os PDFs fictícios dentro do sistema; **Baixar PDF** baixa o arquivo.
   - Como Ana, selecione e inicie o Grupo 01: a tela do Bruno troca sozinha para o grupo atual e a ficha.
10. **Montagem da banca na ordem do menu (admin)**
    - Em **Configuração**, siga as etapas 1 a 8 com os botões "Próxima etapa".
    - Em **3. Tipos de rubrica**, crie um tipo, adicione duas rubricas e troque a ordem com ↑ ↓.
    - Em **4. Banca e dias › Editar banca › Dados gerais**, vincule o tipo à banca.
    - Em **5. Grupos**, cadastre um grupo: a cor já vem escolhida; preencha resumo, orientadores e links.
    - Em **6. Distribuição nos dias**, arraste grupos entre as colunas e confira a ordem (#) e a hora prevista.
    - Em **7. Primário e avaliadores**, designe o primário e os avaliadores; as rubricas do tipo da banca aparecem primeiro.

## Testes automatizados correspondentes

- `server/test/scenarios.test.ts` confere cada situação acima pela API, além das regras a partir de cada estado e do roteiro de preparação.
- `e2e/navigation.spec.ts` cobre a tela inicial, os acessos diretos, o telão sem cabeçalho com a barra que some e o roteiro com "Resolver".
- `server/test/materials.test.ts` e `e2e/config-flow.spec.ts` cobrem materiais, cores, distribuição (inclusive arrastar e soltar), tipos de rubrica e a espera do avaliador.
