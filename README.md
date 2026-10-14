# Sistema de Gestão de Bancas de Projetos

Aplicação web para planejar, conduzir, avaliar e fechar bancas de apresentação de projetos escolares ou acadêmicos. O cronômetro é sincronizado em tempo real, e o sistema inclui rubricas ponderadas, votação configurável, fechamento auditável e PDF por projeto.

A **tela inicial** (`/`) mostra apenas três cartões de acesso. Cada cartão leva direto à área correspondente, passando pelo login quando a área exige. Não há menu de áreas: a marca "Gestão de Bancas", no topo, sempre volta à tela inicial.

O sistema tem **três áreas principais**:

| Área | Rota | Para quem |
| --- | --- | --- |
| **Cronômetro** | `/cronometro` | Telão/projeção minimalista, **sem seleção de dia ou de grupo**. Segue sozinho o dia que o professor primário ativou no telão. O grupo só aparece quando a apresentação é **iniciada**; sem dia ativo, ou na troca de grupo (próximo selecionado mas ainda não iniciado), mostra **"Aguardando"**. Fundo escuro, sem cabeçalho, com o relógio da etapa em destaque (a cor muda na reta final). A barra de ferramentas some após 3 s sem uso. Sem notas nem comentários; nomes dos alunos só se a banca permitir. |
| **Professor** | `/professor` | Acesso individual do docente. O dia é escolhido em cartões que mostram o papel ("Conduz a banca" / "Avalia"). O **avaliador** que entra antes do primário (ou na troca de grupo) **aguarda com a lista do dia em ordem de apresentação**: #ordem na cor do grupo, hora programada, situação e o botão **Projeto**. Quando a apresentação começa, a tela passa sozinha para o grupo atual (com o tempo ao lado) e a ficha. O botão **Resumo e materiais** abre, em modal, o resumo, os orientadores, os alunos, o PDF (ler ou baixar), a apresentação (slides dentro do sistema) e o link do projeto. O primário tem ainda a condução da sessão e a conferência. |
| **Configuração** | `/configuracao` | Administrador. Menu lateral **na ordem de preenchimento**: **Cadastros base** (1. Professores, 2. Perfis de tempo, 3. Tipos de rubrica), **Montagem da banca** (4. Banca e dias, 5. Grupos, 6. Distribuição nos dias, 7. Primário e avaliadores, 8. Votação opcional), além de Visão geral, Acompanhamento, Conferência e fechamento, Relatórios e Auditoria. Cada etapa termina com o botão "Próxima etapa". |

A documentação das rotas e dos eventos em tempo real está em [docs/API.md](docs/API.md). O roteiro de testes manuais, com a banca de cenários, está em [docs/ROTEIRO_TESTES.md](docs/ROTEIRO_TESTES.md).

### Telão: um dia ativo por vez

1. O professor primário (ou o administrador) clica em **Ativar no telão**, na área Professor › Condução da sessão, ou na Configuração › Visão geral. Se nenhum dia estiver ativo, o primeiro **Iniciar apresentação** ativa o dia automaticamente.
2. O `/cronometro` passa a exibir esse dia sozinho, por sinal em tempo real e com consulta de segurança a cada 5 s. A tela não tem lista nem seleção.
3. **Selecionar** um grupo não o mostra no telão: o telão continua em "Aguardando". Ao clicar em **Iniciar apresentação**, o grupo e o tempo aparecem automaticamente.
4. Ao fim do tempo, o telão mantém **TEMPO ENCERRADO** até o primário selecionar o próximo grupo. Nesse momento volta a "Aguardando".
5. **Contagem regressiva:** ao clicar em **Iniciar apresentação**, o telão sai do "Aguardando" e mostra números grandes de **10 até 0**, cada um encolhendo até sumir antes do próximo aparecer. A mesma contagem aparece na tela dos professores. Ao zerar, o cronômetro começa. A contagem é definida pelo relógio do servidor (`running_since` no futuro), por isso é igual em todas as telas. As fichas já são liberadas no clique.
6. **Palmas:** quando o tempo total estoura (TEMPO ENCERRADO), o telão toca um som de palmas, sintetizado no navegador, sem arquivo externo. Encerrar antes do tempo não toca. Os navegadores só liberam áudio depois de um clique ou tecla na página: enquanto isso não acontece, o telão mostra o aviso "Clique na tela para ativar o som das palmas". A opção **Palmas no fim** fica na barra do telão.
7. **Professores avaliadores** veem o cronômetro (e a contagem) na própria tela, sem nenhum controle: só o professor primário inicia, pausa ou encerra.
8. Só existe um dia ativo por vez: ativar outro dia substitui o anterior, e a área do professor avisa quando o telão está em outro dia. Banca sem exibição pública só aparece para quem entra com a conta do telão.

### Hierarquia da banca e ordem de preenchimento

```
Banca (tipo de rubrica da banca)
 ├─ Dias (data, horário, sala, intervalos, perfil de tempo)
 │   ├─ Grupos, em ordem (#1, #2…), com hora prevista calculada
 │   └─ Professor primário + avaliadores (cada um com uma rubrica do tipo)
 └─ Grupos (resumo, alunos, orientadores, materiais, cor; tipo de rubrica próprio, se precisar)
Tipo de rubrica ── várias rubricas (fichas), em ordem: 1ª, 2ª, 3ª…
```

1. **Professores** — contas de acesso (professor, administrador, telão).
2. **Perfis de tempo** — etapas da apresentação (ex.: 10 + 5 + 5 min).
3. **Tipos de rubrica** — cada tipo reúne as rubricas usadas juntas (ex.: "Projeto Integrador" com 4 fichas). Cria-se o tipo e, dentro dele, as rubricas; a ordem (↑ ↓) define a 1ª, 2ª… ficha. Rubricas podem ser movidas entre tipos. O modelo Projeto Integrador já vem como um tipo.
4. **Banca e dias** — dados da banca e **o tipo de rubrica que ela usa**; os dias. O formulário da banca é dividido em abas (Dados gerais, Regras da avaliação, Documento PDF).
5. **Grupos** — código, turma, título, **resumo**, alunos, **professores orientadores** (vários), **materiais** (link da apresentação, link do PDF, link de acesso ao projeto) e **cor de identificação**, gerada no cadastro (a menos usada na banca) e editável. O grupo pode usar outro tipo de rubrica.
6. **Distribuição nos dias** — quadro com uma coluna por dia e a coluna "Sem dia": **arraste** cada grupo para o dia e a posição; a ordem (#) e a hora prevista se atualizam na hora. Sem mouse: "Mover para…" e as setas ↑ ↓. A aba "Horários e perfis do dia" mantém a visão detalhada (perfil por grupo, ordenar por número/turma/título).
7. **Primário e avaliadores** — por dia: quem conduz e quem avalia, escolhendo a rubrica numa lista agrupada por tipo (o tipo da banca primeiro).
8. **Votação** (opcional).

**Rubrica de um grupo com outro tipo:** o avaliador designado com a rubrica de posição N do tipo da banca recebe, nesse grupo, a rubrica de posição N do tipo do grupo (1ª ↔ 1ª, 2ª ↔ 2ª), na versão mais recente. Atribuições "somente este grupo" e rubricas sem tipo valem como foram feitas.

**Cor do grupo:** aparece na borda do grupo em destaque e no selo **#ordem** da área do professor, na lista de espera, no quadro de distribuição e no cabeçalho do telão.

**Materiais:** os links aceitos começam com `https://` (ou um caminho do próprio sistema, como `/demo/...`). Google Apresentações, Google Drive/Docs e Canva são convertidos para o endereço de incorporação; os demais abrem como estão. Se o site de origem bloquear a exibição dentro de outra página, o modal oferece "Abrir em nova aba". A banca de demonstração usa dois PDFs fictícios em `web/public/demo/`.

### Roteiro de preparação (Configuração › Visão geral)

Para a banca selecionada, o painel lista o que está **pronto**, o que pede **atenção** e o que está **pendente**. A verificação é feita na banca e em cada dia:

- **Banca:** dias, grupos ainda sem dia ou sem alunos, tipo de rubrica vinculado (e com rubricas) e Local impresso.
- **Cada dia:** professor primário ativo, grupos no cronograma, perfil de tempo, horários (estouro e intervalos) e avaliadores ativos para todos os grupos.

Cada item pendente tem o botão **Resolver**, que abre a seção certa. O painel também mostra o progresso de cada dia (apresentados e fechados) e atalhos para a área do professor e o telão.

## Rubrica da Banca do Projeto Integrador

O instrumento "Rubrica de Avaliação da Banca do Projeto Integrador" já vem instalado. São 4 rubricas, uma por avaliador, cada uma com 5 critérios transcritos do documento original:

| Avaliador | Dimensão | Pontuação |
| --- | --- | --- |
| 1 - Professor técnico | Solução tecnológica | 0 a 25 |
| 2 - Professor do artigo e pesquisa | Qualidade acadêmica do artigo | 0 a 25 |
| 3 - Professor do Projeto Integrador | Investigação, integração e impacto | 0 a 25 |
| 4 - Professor da apresentação | Comunicação, defesa e postura | 0 a 25 |

- **Escala:** de 0 a 5, com rótulos por nível (Não evidenciado, Inicial, Parcial, Adequado, Consistente, Plenamente desenvolvido). Na ficha, a nota é escolhida por botões de nível.
- **Totais:** o subtotal de cada avaliador é a soma dos pontos (até 25), e o **total da banca é a soma dos subtotais (até 100)**.
- **Parecer da banca:** quatro opções (plenamente desenvolvido, desenvolvido, em desenvolvimento, necessita retomada), mais pontos fortes, prioridades de melhoria e orientações finais. O parecer é registrado na conferência e é obrigatório para fechar.
- **Como usar em uma banca:** em **Configuração → Banca e dias → Modelos prontos**, clique em **Aplicar modelo Projeto Integrador**. O botão instala o tipo de rubrica "Projeto Integrador" (as 4 fichas), vincula-o à banca e configura a soma, o parecer e os textos do documento. Depois, em **Primário e avaliadores**, vincule cada professor à rubrica da sua dimensão, em cada dia.
- **Demonstração:** a "Banca do Projeto Integrador — DEMONSTRAÇÃO" usa dados fictícios e tem dois dias com escalas diferentes.

### Escala de professores por dia

Cada dia de banca tem sua própria escala. O mesmo professor pode participar de um dia, de vários ou de nenhum, e pode usar rubricas diferentes em cada dia. Há três formas de montar a escala:

- **Por dia** (Configuração → 7. Primário e avaliadores): o primário e a tabela de avaliadores do dia, inclusive com atribuições a grupos específicos.
- **No cadastro do professor** (Configuração → 1. Professores → Editar), opcional: marque os dias em que ele avalia e a rubrica de cada dia. A tabela de contas mostra os dias de cada professor.
- **Copiar escala de outro dia**, como ponto de partida; depois ajuste o dia livremente.

Um professor não pode ser removido de um dia em que já tem fichas (registre a dispensa no fechamento) nem de um dia em que é o primário (troque o primário antes).

### PDF no formato do instrumento, preenchido

O PDF de cada projeto segue o documento original e sai preenchido:

1. **Capa:** título, subtítulo, Grupo, Turma, Título, Data, Horário e Local; finalidade da banca, escala de avaliação, composição da banca e orientação.
2. **Uma página por avaliador:** responsabilidade, critérios com os pontos, subtotal "x / 25", devolutiva e nome do avaliador, com a data do envio eletrônico.
3. **Registro consolidado:** tabela dos avaliadores, **TOTAL DA BANCA x / 100**, parecer marcado com "(X)", pontos fortes, prioridades, orientações e campos de assinatura.
4. **Informações complementares:** votação e exceções (quando houver), método de cálculo e dados do fechamento.

O logotipo institucional (PNG ou JPEG) é enviado em "Editar banca". Por questão de marca, o sistema não inclui nenhum logotipo por padrão.

### Local impresso (sala + local da escola)

Em **Editar banca → Local impresso**, defina o **Local da escola** e o **Modelo de escrita do Local** com os marcadores `{sala}` e `{escola}`, por exemplo `{sala} — {escola}` ou `{escola}, {sala}`. A tela mostra uma pré-visualização. A sala vem do cadastro de cada dia, e o resultado sai no campo "Local" do PDF. Se um dos dois estiver vazio, sai apenas o outro.

---

## Stack e motivos

Todas as versões estão fixadas (sem `^`) nos `package.json`. Após a instalação, `npm audit` retornou **0 vulnerabilidades**.

| Camada | Tecnologia (versão) | Motivo |
| --- | --- | --- |
| Runtime | Node.js ≥ 20.19 (testado em **24.21.0**) | Disponível no ambiente. |
| Backend | **Fastify 5.12.5** + `@fastify/websocket 11.3.4`, `@fastify/cookie 11.1.3`, `@fastify/static 10.1.6` | Rápido e tipado, com WebSocket nativo. As versões foram atualizadas para corrigir CVEs apontadas pelo `npm audit`. |
| Validação | **Zod 3.25.76** | Validação estruturada de toda entrada. |
| Banco | **PostgreSQL** via `pg 8.16.3` quando `DATABASE_URL` está definido. Sem ele, usa **PGlite 0.3.14** (PostgreSQL compilado para WASM) | O ambiente de desenvolvimento não tinha PostgreSQL instalado nem Docker ativo. O PGlite roda o motor PostgreSQL real com o mesmo SQL e as mesmas restrições, índices parciais e transações. Ver a seção "Limitações honestas". |
| PDF | **pdfkit 0.17.2**, gerado no servidor | Sem navegador headless; paginação controlada. |
| Senhas | `crypto.scrypt` nativo do Node (N=16384, sal aleatório) | Sem dependência nativa extra. |
| Execução TS | **tsx 4.23.15** | Executa TypeScript direto (dev e produção); o `tsc --noEmit` faz a checagem de tipos. |
| Frontend | **React 19.2** + **Vite 7.3.7** + **React Router 7.18.4** (TypeScript 5.9.3) | SPA leve e servida pelo próprio backend em produção. |
| Componentes acessíveis | **Radix UI** (`react-dialog 1.1.15`, `react-tabs 1.1.13`) | Diálogos e abas com foco, teclado e ARIA corretos. |
| Arrastar e soltar | **dnd-kit** (`core 6.3.1`, `sortable 10.0.0`) | Funciona por teclado (Espaço + setas). |
| Testes | **Vitest 4.1.11** (unidade e integração), **Playwright 1.56.1** (ponta a ponta, Chromium) | |

O código de domínio compartilhado fica em [shared/](shared/) e é usado pelo servidor e pelo cliente:

- `timer.ts`: cálculo de etapas, faixas e formato do relógio;
- `scoring.ts`: fórmula ponderada e validação de escala;
- `schedule.ts`: previsão do cronograma e validação de intervalos;
- `votes.ts`: apuração dos votos.

## Requisitos

- Node.js 20.19+ e npm 10+.
- Opcional: PostgreSQL 14+ (para usar um servidor real em vez do PGlite).
- Para os testes E2E: o navegador do Playwright (`npx playwright install chromium`).

## Instalação e execução local

```bash
npm install
cp .env.example .env          # ajuste se necessário (caminhos relativos partem da raiz do projeto)
npm run build -w web          # gera web/dist (servido pelo backend)
npm run start                 # http://127.0.0.1:3000
```

Na primeira execução **fora de produção**, o servidor aplica as migrações e cria o **seed de demonstração** com dados **fictícios**. Todas as contas usam a senha `demo1234`:

| Conta | Papel |
| --- | --- |
| `admin@demo.banca` | Administrador |
| `ana@demo.banca` | Professora primária do Dia 1 e avaliadora (Rubrica Técnica) |
| `bruno@demo.banca` | Avaliador (Rubrica Técnica) |
| `carla@demo.banca` | Avaliadora (Rubrica de Comunicação) |
| `telao@demo.banca` | Visualização do cronômetro |

O seed cria:

- a banca "Banca de Projetos — DEMONSTRAÇÃO", com um dia na data de hoje, das 07:30 às 12:30, com intervalo das 10:00 às 10:20;
- o perfil de tempo **10 + 5 + 5 min**;
- os grupos "Grupo 01" e "Grupo 02", com alunos fictícios;
- duas rubricas exemplificativas;
- a pergunta de votação "Indicação para a feira".

Também é criada a **Banca de Cenários de Teste — DEMONSTRAÇÃO**, com um grupo em **cada situação do processo**:

- finalizado;
- finalizado com dispensas;
- reaberto e fechado na versão 2;
- reaberto aguardando correção;
- aguardando fechamento com votação empatada;
- iniciado com pendências;
- em andamento (pausado);
- aguardando;
- fora do cronograma;
- um dia com preparação incompleta.

Ela traz ainda o avaliador extra `fabio@demo.banca`, só de um grupo. Veja o passo a passo em [docs/ROTEIRO_TESTES.md](docs/ROTEIRO_TESTES.md). Para não criá-la, use `SEED_SCENARIOS=0`.

### Desenvolvimento (recarga automática)

```bash
npm run dev    # backend :3000 (tsx watch) + Vite :5173 com proxy de /api e /ws
```

Abra `http://127.0.0.1:5173`.

**Modo de testes acelerado:** `TIMER_SPEED=60 npm run dev` faz 1 minuto do cronômetro passar em 1 segundo. O servidor **recusa** esse valor quando `NODE_ENV=production`. As regras não mudam: etapas, faixas e eventos são os mesmos, só o relógio anda mais rápido.

### Usando PostgreSQL real

```bash
createdb bancas
DATABASE_URL=postgres://usuario:senha@localhost:5432/bancas npm run db:migrate
DATABASE_URL=... npm run db:seed      # opcional (demonstração)
DATABASE_URL=... npm run start
```

### Variáveis de ambiente ([.env.example](.env.example))

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` desativa o seed automático e a aceleração e exige `COOKIE_SECRET`. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Endereço do servidor. |
| `DATABASE_URL` | vazio | PostgreSQL. Se vazio, usa PGlite em `PGLITE_DIR`. |
| `PGLITE_DIR` | `.data/pglite` | Diretório do banco embutido. |
| `COOKIE_SECRET` | (dev) | Obrigatório em produção, com mínimo de 32 caracteres. |
| `COOKIE_SECURE` | `false` | `true` atrás de HTTPS. |
| `SESSION_TTL_HOURS` | `12` | Validade da sessão. |
| `TIMER_SPEED` | `1` | Aceleração do cronômetro, só fora de produção. |
| `COUNTDOWN_SECONDS` | `10` | Contagem regressiva (10 … 0) ao iniciar a apresentação; `0` desliga. Nos testes automatizados de servidor é 0, exceto em `countdown.test.ts`. |
| `DEFAULT_TIMEZONE` | `America/Sao_Paulo` | Fuso padrão. |

## Testes

```bash
npm test                         # Vitest: unidade + integração (PGlite em memória, relógio simulado) + WebSocket real
npm run build -w web             # pré-requisito do E2E
npx playwright install chromium  # uma vez
npm run test:e2e                 # Playwright: 3 navegadores (primária, avaliadores, telão), servidor com TIMER_SPEED=60
npm run typecheck                # tsc nos dois projetos
```

Resultado da última execução local (2026-10-12):

- **Vitest:** 9 arquivos e **98 testes passando**.
- **Playwright:** **9 testes passando**.
- **Typecheck:** sem erros.

| Arquivo | O que cobre |
| --- | --- |
| [server/test/domain.test.ts](server/test/domain.test.ts) | Fórmula ponderada, zero versus vazio, dispensa, normalização, incrementos, 20:00 inicial, transições aos 10 e 15 min, faixas de cor, fim sem tempo negativo, cronograma com intervalos e estouro, validação de intervalos, apuração (maioria, empate, quórum, contagem). |
| [server/test/flow.test.ts](server/test/flow.test.ts) | Fluxo completo pela API, incluindo autorização (anônimo, avaliador, telão, docente sem vínculo), CSRF, hash de senha, cadastro e reordenação, início idempotente, abertura das fichas, rubricas diferentes, ficha alheia bloqueada, pausa/retomada, restauração após "recarregar", TEMPO ENCERRADO sem finalizar avaliações, ajuste auditado, conflito de revisão, voto sem duplicidade, fechamento bloqueado, fechamento concorrente único, bloqueio pós-fechamento, PDF (autorização e conteúdo), reabertura versionada, troca de grupo, exceção de avaliador ausente, PDF em lote, versionamento de rubrica. |
| [server/test/realtime.test.ts](server/test/realtime.test.ts) | Dois clientes WebSocket reais (telão anônimo e docente) recebem início, abertura das fichas e pausa com o mesmo tempo decorrido. Reconexão restaura a mesma sessão. Mensagens sem notas. Exibição pública desativada bloqueia anônimos. |
| [server/test/pdf.test.ts](server/test/pdf.test.ts) | PDF longo (40 critérios com comentários extensos) quebra em várias páginas sem perder texto, com numeração "Página X de Y". |
| [server/test/pi.test.ts](server/test/pi.test.ts) | Rubrica do Projeto Integrador: escala 0–5 com rótulos, recusa de nota fora da escala ou do incremento, subtotais 25/20/15/15 e total 75/100 pela soma, parecer obrigatório e restrito ao primário/administrador, texto do PDF no formato do instrumento, logotipo, Local concatenado, escala por dia (professor com rubricas diferentes, professor que não se repete), cópia de escala e dias de participação no cadastro do professor (com as proteções). |
| [server/test/scenarios.test.ts](server/test/scenarios.test.ts) | Banca de cenários: cada grupo na situação esperada; histórico de versões, reabertura e exceções; eventos do cronômetro (reinício, encerramento antecipado, ajuste, pausa, tempo esgotado); votação empatada; fechamento bloqueado com pendências (inclusive de avaliador extra) e com cronômetro ativo; reinício recusado em grupo fechado; reenvio após reabertura (v2); roteiro de preparação; correções do processo (contagem sem duplicidade, atribuição duplicada, atribuição do primário, ficha de avaliador designado depois do início). |
| [server/test/materials.test.ts](server/test/materials.test.ts) | Grupo com resumo, vários orientadores, links e cor gerada (a menos usada); cor mantida na edição; links perigosos recusados (`javascript:`, `data:`); campo antigo "orientador"; distribuição atômica (`/groups/:id/place`: entrar no dia na posição, reordenar, mudar de dia levando as atribuições do grupo, sair do cronograma, renumeração, só administrador, dia de outra banca, grupo já apresentado fixo); materiais na área do professor (só quem atua no dia); cor e ordem no telão; tipos de rubrica (criação, nome único, ordem, rubrica nova no fim do tipo, exclusão só sem uso) e equivalência por posição quando o grupo usa outro tipo. |
| [server/test/demo.test.ts](server/test/demo.test.ts) | Complemento das bancas de demonstração: tipo de rubrica em cada banca, resumo, orientadores e materiais fictícios; idempotente e sem sobrescrever o que já foi preenchido; cores distintas; migrações idempotentes. |
| [e2e/navigation.spec.ts](e2e/navigation.spec.ts) | Tela inicial com três acessos e sem menu; acesso direto ao login e à área; telão sem cabeçalho com barra que some quando ociosa; roteiro de preparação com "Resolver" levando à seção certa; nenhuma seção transborda a 390 px; envio bloqueado quando o salvamento da ficha falha (HTTP 500 simulado). |
| [e2e/pi-flow.spec.ts](e2e/pi-flow.spec.ts) | Banca do Projeto Integrador pela interface: 4 professores avaliam com os botões de nível, a primária registra o parecer, fecha (81/100) e baixa o PDF preenchido. |
| [e2e/config-flow.spec.ts](e2e/config-flow.spec.ts) | Configuração inteira pela interface, **na ordem do menu**: conta do docente, perfil de tempo, tipo de rubrica com duas rubricas, banca vinculada ao tipo (formulário em abas), dia, dois grupos com resumo, orientadores, materiais e cores diferentes, distribuição por "Mover para" e **arrastando com o mouse**, setas de ordem, primário e avaliador, votação e roteiro "pronta para começar". O avaliador entra antes, aguarda com a lista em ordem (07:30 / 07:47), abre o modal do projeto e a apresentação; o docente novo inicia, a ficha do avaliador abre sozinha com a 2ª rubrica do tipo, e a auditoria registra as ações. |
| [e2e/demo-flow.spec.ts](e2e/demo-flow.spec.ts) | Fluxo obrigatório de demonstração em navegadores reais (inclui a espera do avaliador com #ordem e o modal de materiais) e a alternativa sem piscada com `prefers-reduced-motion`. |

## Build e implantação

```bash
npm ci
npm run build                    # typecheck + build do frontend (web/dist)
NODE_ENV=production COOKIE_SECRET=<32+ caracteres aleatórios> COOKIE_SECURE=true \
DATABASE_URL=postgres://... HOST=0.0.0.0 PORT=3000 npm run start
```

Para implantar:

- Rode o servidor atrás de um proxy reverso com HTTPS (nginx, Caddy etc.), repassando `Upgrade`/`Connection` em `/ws` para o WebSocket.
- Em produção as migrações rodam na inicialização, e o seed de demonstração **não** é criado. Para criar o primeiro administrador, há duas opções:
  - rodar `npm run db:seed -- --allow-production` e trocar ou desativar as contas demo imediatamente;
  - ou inserir o usuário diretamente no banco.
- Use **uma única instância** do backend: o canal em tempo real e o ticker do cronômetro rodam em memória por processo. Ver as limitações abaixo.

**Implantação: PENDENTE.** Nenhum deploy foi feito; apenas execução local.

## Diagrama de estados

```mermaid
stateDiagram-v2
    direction LR
    state "Apresentação (grupo)" as G {
        [*] --> Aguardando
        Aguardando --> EmAndamento: Iniciar apresentação\n(registra início real, check "Iniciado",\nabre fichas + votação)
        EmAndamento --> Iniciado: tempo esgotado / encerrar /\ntroca de grupo (com justificativa)
        Iniciado --> AguardandoFechamento: todas as fichas obrigatórias\nenviadas (ou dispensadas)
        AguardandoFechamento --> Finalizado: Conferir e fechar\n(snapshot imutável vN)
        Finalizado --> Iniciado: Reabrir (admin + motivo)\nfichas voltam a rascunho → vN+1
    }
    state "Cronômetro (sessão)" as T {
        [*] --> NaoIniciado
        NaoIniciado --> EmExecucao: iniciar
        EmExecucao --> Pausado: pausar
        Pausado --> EmExecucao: retomar
        EmExecucao --> EmExecucao: troca automática de etapa / avançar
        EmExecucao --> Encerrado: total = 00:00 (TEMPO ENCERRADO)\nou encerrar antes do prazo
        Pausado --> Encerrado: encerrar
        Encerrado --> Pausado: ajustar tempos (total maior)
        EmExecucao --> Histórico: reiniciar (motivo) / troca de grupo
        Histórico --> NaoIniciado
    }
    state "Ficha do avaliador" as F {
        [*] --> Rascunho: abre ao iniciar
        Rascunho --> Rascunho: autosave (revisão +1)
        Rascunho --> Enviada: enviar (sem pendências)
        Enviada --> Rascunho: editar (só política "até o fechamento")\nou reabertura administrativa
        Enviada --> Bloqueada: fechamento
    }
```

O **término do tempo não fecha a avaliação**: são estados independentes.

## Regras e decisões de padrão

Quando a especificação deixou margem, adotei a opção mais segura e documentei aqui.

- **Revisão do processo (regras reforçadas):**
  - O fechamento exige a **apresentação encerrada**: com o cronômetro rodando ou pausado, a conferência mostra o bloqueio "encerre o cronômetro antes de fechar".
  - **Reiniciar** é recusado em grupo com avaliação fechada; é preciso reabrir antes.
  - Avaliador **designado depois do início** recebe a ficha ao abrir a área do professor ou a conferência. Assim ele pode avaliar ou ser dispensado; antes, ficava como "ficha não aberta" sem como dispensar.
  - A situação "Aguardando fechamento" conta cada avaliador **uma vez**: quem foi dispensado e também enviou não conta em dobro.
  - Atribuição duplicada responde com mensagem clara. A edição da rubrica de uma atribuição valida se ela existe. A atribuição geral do **professor primário** só é removida depois de trocar o primário.
  - Ao mudar um grupo de dia, as atribuições específicas do grupo acompanham o grupo.
- **Achados da [auditoria de UX/UI](docs/AUDITORIA-UX-UI-2026-10-11.md) tratados nesta versão:**
  - **P1, envio diferente do exibido:** o envio só acontece depois de confirmar que o servidor gravou exatamente o conteúdo exibido. Se o salvamento falha, nada é enviado e a edição permanece. Coberto por E2E com HTTP 500 simulado.
  - **P1, conferência de outro dia:** a seleção é validada contra o dia atual, e os dados de outro dia não são exibidos durante a troca.
  - **P1, escala vazia após erro de leitura:** o erro aparece com "Tentar novamente", e a escala só é gravada quando foi lida com sucesso e alterada.
  - **P1, parecer não salvo:** o fechamento fica bloqueado com o aviso "Salve o parecer antes de fechar". Depois do fechamento, o parecer exibido vem do registro fechado.
  - **P1, conferência desatualizada:** o fechamento envia um *token* dos dados conferidos. Se uma ficha, voto, exceção ou parecer mudou desde a conferência, o servidor recusa com `REVIEW_STALE` e a tela recarrega.
  - **P1, telão com dados do dia anterior:** a troca de dia descarta o estado anterior, e respostas atrasadas de outro dia são ignoradas.
  - **P2:** navegação lateral agrupada, com a seção na URL (`?secao=`); nenhuma seção transborda a 320, 390 ou 768 px; números globais rotulados como "do sistema" e separados do roteiro da banca; "Ajustar tempos" recomeça da sessão atual a cada abertura.
  - **Ainda não tratados:** os demais itens P2 da auditoria (troca remota de grupo durante edição, aviso de armazenamento local indisponível, falha de logout, proteção contra fechar diálogos longos com alterações, editor de rótulos de escala, estados vazios × erro em listas, legibilidade da auditoria). Continuam como recomendações.

- **Tempo autoritativo:** o servidor persiste, por sessão, `status`, `accumulated_ms`, `running_since`, `speed` e uma **cópia das etapas** (snapshot do perfil). O decorrido é sempre `accumulated + (agora − running_since) × speed`, com o relógio do servidor. Recarregar ou abrir outra tela apenas lê esse estado.
  - Um ticker de 250 ms registra as trocas de etapa e o fim do tempo como eventos em `timer_events`.
  - O cliente interpola com `performance.now()` (monotônico).
- **Unicidade:**
  - um cronômetro ativo por dia/sala (índice único parcial);
  - uma sessão vigente por apresentação;
  - um grupo por entrada de cronograma;
  - uma ficha por docente e grupo;
  - um voto por ficha e pergunta;
  - um fechamento vigente por grupo.
- **Controles concorrentes:** cada ação de controle trava a linha do dia (`SELECT … FOR UPDATE`) dentro de uma transação. "Iniciar", "enviar" e "fechar" repetidos não duplicam nada: o início é idempotente, o envio é idempotente para a mesma revisão, e o segundo fechamento recebe 409.
- **Faixas de cor:** usam o percentual restante **da etapa**, conforme a especificação funcional §3.4.
  - Os limiares são editáveis por banca: normal acima de 50%, amarelo de 50% a 21%, laranja de 20% a 1%.
  - O vermelho piscante aparece quando o **total** chega a 00:00.
  - Todas as faixas têm texto e ícone além da cor.
  - Com `prefers-reduced-motion` ou com a opção "Reduzir animações", a piscada vira um alerta vermelho estático com borda dupla.
- **Avançar etapa** pula para o início da próxima. O tempo não usado da etapa é descontado do total; na última etapa, avançar encerra o tempo.
- **Ajustar tempos** altera só a sessão em curso, nunca o perfil global. Exige justificativa e é auditado. Se o tempo já tinha esgotado e o ajuste aumenta o total, a sessão volta a "Pausado".
- **Troca de grupo** com apresentação ativa exige confirmação e justificativa. A sessão anterior é encerrada e preservada no histórico, junto com as fichas.
- **Edição após envio:** o padrão é `locked` (bloqueada). A alternativa `until_closure` permite editar, mas devolve a ficha a rascunho e exige reenviar.
- **Cálculo:** `pontuação = Σ(nota/10 × peso) / Σ(pesos avaliados) × 100`, e o resultado final é a média simples das avaliações válidas.
  - Critério sem nota (opcional ou dispensado) **não** conta como zero: sai do numerador e do denominador.
  - Escalas diferentes de 0–10 exigem `normalization = linear`, configurada explicitamente.
  - O banco guarda a precisão integral; o arredondamento para duas casas acontece só na exibição e no PDF.
- **Exceções:** só o administrador registra exceções, sempre com motivo.
  - Avaliador ausente sai da base de cálculo.
  - Critério dispensado sai do cálculo daquele avaliador.
  - As duas aparecem na conferência e no PDF.
- **Votação:** fica separada das notas e nunca é inferida da média.
  - Regras disponíveis: maioria simples dos votos válidos (abstenção não conta; empate não decide), quórum mínimo, ou somente contagens.
  - Os votos aparecem de forma nominal ou anônima, conforme a política da banca.
- **Fechamento:** grava um snapshot JSON imutável com versão, autor e data. O PDF é gerado **a partir do snapshot**, por isso é idêntico à conferência.
  - A reabertura é exclusiva do administrador e exige motivo de pelo menos 10 caracteres.
  - Na reabertura, as fichas voltam a rascunho e o snapshot antigo fica no histórico; o PDF da versão anterior continua disponível.
- **Rubricas:** uma versão já usada em fichas não pode ser editada (409). É preciso criar uma nova versão; as fichas abertas mantêm a versão original.
- **Professor primário:** é designado por dia, no máximo um, e cada troca fica registrada na auditoria. Ele **avalia como os demais professores**: na designação o administrador escolhe a rubrica dele, e o sistema cria (ou atualiza) a atribuição para todos os grupos do dia. Além de avaliar, o primário seleciona o grupo, controla o cronômetro e confere/fecha as avaliações. Grupos já fechados não recebem fichas novas.
- **Tipos de rubrica:** um tipo em uso por banca ou grupo não pode ser excluído; ao excluir um tipo livre, as rubricas continuam cadastradas, sem tipo. A banca aponta um tipo; o grupo pode apontar outro (equivalência por posição, veja "Hierarquia da banca").
- **Distribuição:** colocar, mover entre dias, reordenar e tirar do cronograma é uma operação única e atômica no servidor. Grupo que já se apresentou não muda de dia nem sai do cronograma (reordenar no mesmo dia continua permitido). Ao sair do dia, as posições se renumeram (1, 2, 3…).
- **Cor do grupo:** gerada no cadastro como a cor da paleta (12 cores) menos usada na banca; pode ser trocada. Grupos antigos recebem cores distintas na migração.
- **Atribuições:** podem valer para o dia todo ou para um grupo específico, e a do grupo prevalece. Uma atribuição não pode ser removida depois que houver fichas sob ela; nesse caso, use a dispensa no fechamento.
- **Exibição pública:** o telão sem login só funciona se a banca permitir (padrão: sim) e nunca recebe dados privados. Os nomes dos alunos ficam ocultos por padrão.
- **Fuso:** os carimbos de tempo ficam em `timestamptz` (UTC); a interface formata no fuso da banca. As previsões do cronograma usam horários "HH:MM" locais.

## Segurança

- Senhas com scrypt e sal. Sessões com token aleatório de 256 bits, guardado no banco apenas como hash SHA-256, em cookie `HttpOnly`, assinado e `SameSite=Lax` (`Secure` configurável).
- **CSRF:** cabeçalho obrigatório `x-banca-csrf` em mutações; CORS não habilitado.
- Limite de tentativas de login.
- Cabeçalhos de segurança: CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, e `Cache-Control: no-store` na API. A CSP permite `frame-src 'self' https:` para exibir PDF e slides dentro do modal; o próprio sistema continua sem poder ser embutido em outros sites (`frame-ancestors 'self'`).
- Links de materiais: só `https://`/`http://` ou caminhos do próprio sistema (validado no servidor e no banco); abertos com `rel="noopener noreferrer"`. O resumo e os materiais só são entregues a quem atua no dia do grupo.
- Autorização no servidor em toda rota: fichas só para o dono; conferência e PDF só para administrador e primário do dia; reabertura e exceções só para administrador.
- Validação de toda entrada com Zod e restrições de integridade no banco.
- Auditoria de login, cadastros, ajustes de tempo, troca de grupo, envio de fichas, fechamentos, reaberturas, exceções e downloads de PDF.
- Nenhuma credencial no frontend; segredos ficam em `.env`, que não é versionado.

## Limitações honestas

- **PostgreSQL servidor:** todo o SQL foi executado e testado no **PGlite**, que é o motor PostgreSQL compilado para WASM. O caminho `pg`/`DATABASE_URL` está implementado com o mesmo SQL, mas **não foi executado** contra um servidor PostgreSQL neste ambiente, que não tinha PostgreSQL nem daemon Docker.
- **Escala horizontal:** o hub WebSocket e o ticker ficam em memória por processo. Para várias instâncias, seria preciso um barramento (por exemplo, PostgreSQL `LISTEN/NOTIFY` ou Redis).
- **Salas paralelas:** cada dia funciona como uma sessão/sala com um grupo ativo. Para salas simultâneas, cadastre um "dia" por sala, na mesma data.
- **Rascunho offline:** fica no `localStorage` do dispositivo, com aviso, e é sincronizado ao reconectar. Conflitos de revisão pedem escolha explícita: carregar a versão do servidor ou manter as alterações locais.
- O tempo do cronômetro **não** depende do relógio do navegador. Mesmo assim, se o servidor ficar desligado durante uma apresentação em execução, o tempo continua contando pelo relógio de parede ao voltar, pois é calculado a partir de `running_since`.

## Checklist de aceite

**VALIDADO LOCALMENTE** = coberto por teste automatizado que passou nesta máquina. Os testes estão nos arquivos `server/test/*.test.ts` e `e2e/demo-flow.spec.ts`.

| # | Critério | Situação | Evidência |
| --- | --- | --- | --- |
| 1 | Admin cadastra banca com dia, horário, intervalo e grupos | VALIDADO LOCALMENTE | `flow.test.ts` › "administrador cadastra banca, dia com intervalo e grupos…"; pela interface: `config-flow.spec.ts` |
| 2 | Distribuir/reordenar grupos com horário recalculado | VALIDADO LOCALMENTE | `flow.test.ts` (reordenação, ordenação por turma e título, previsões 07:30/07:55/08:20, empurrão após o intervalo, estouro); `materials.test.ts` (distribuição entre dias); `config-flow.spec.ts` (**arrastar e soltar** no quadro, "Mover para" e setas, hora prevista 07:47). |
| 3 | Perfil 10+5+5 mostra 20:00 antes de iniciar | VALIDADO LOCALMENTE | `domain.test.ts`; `flow.test.ts` › "antes de iniciar…"; E2E (`Tempo total restante 20:00` no telão) |
| 4 | Ao iniciar, professores veem a ficha correta sem recarregar | VALIDADO LOCALMENTE | E2E (Bruno e Carla veem os próprios critérios após o clique da primária); `realtime.test.ts` |
| 5 | Cronômetro não reinicia ao recarregar e é consistente em dois navegadores | VALIDADO LOCALMENTE | E2E (`telao.reload()`); `flow.test.ts` (novo serviço lendo o mesmo banco); `realtime.test.ts` (mesmo `elapsedMs` e `sessionId` em dois clientes e após reconexão) |
| 6 | Etapa muda automaticamente: apresentação → demonstração → perguntas | VALIDADO LOCALMENTE | `domain.test.ts`; `flow.test.ts`; E2E (acelerado 60x) |
| 7 | Cor por faixa; 00:00 total com vermelho piscante ou alternativa | VALIDADO LOCALMENTE | `domain.test.ts` (faixas); E2E ("TEMPO ENCERRADO"; `over-static` com movimento reduzido) |
| 8 | Só primário e admin controlam o cronômetro, inclusive por API | VALIDADO LOCALMENTE | `flow.test.ts` (403 para avaliador e telão, 401 para anônimo); E2E (sem botões para o avaliador) |
| 9 | Check "Iniciado" e horário real automáticos | VALIDADO LOCALMENTE | `flow.test.ts` (`started`, `startedAt`); E2E (check no cronograma) |
| 10 | Troca de grupo sem perder avaliações e sem dois ativos | VALIDADO LOCALMENTE | `flow.test.ts` › "troca para o Grupo 02…"; E2E (Grupo 01 segue "Finalizado"; ficha do Bruno preservada) |
| 11 | Rascunho, nota zero válida, comentários, envio com requisitos | VALIDADO LOCALMENTE | `flow.test.ts` › "nota zero é válida…"; E2E (Bruno envia com nota 0) |
| 12 | Rubricas diferentes mostram só os próprios critérios | VALIDADO LOCALMENTE | `flow.test.ts`; E2E (Carla não vê "Domínio técnico") |
| 13 | Fechamento exibe notas, pesos, textos, votos e cálculo; bloqueia pendências | VALIDADO LOCALMENTE | `flow.test.ts` (bloqueio; 85/35/85 → 68,33; apuração) |
| 14 | Fechado: bloqueio de edição; PDF com a mesma consolidação | VALIDADO LOCALMENTE | `flow.test.ts` (409 em edição; texto do PDF com 68,33, 85,00, 35,00, justificativas, "Fechamento v1"); E2E (download `%PDF-`) |
| 15 | Reabertura com motivo gera versão e mantém histórico | VALIDADO LOCALMENTE | `flow.test.ts` › "reabertura só por administrador…" (v1 → v2, PDF da v1 preservado) |
| 16 | Não autorizado não acessa notas, fichas nem PDFs por URL/API | VALIDADO LOCALMENTE | `flow.test.ts` (fichas alheias, docente sem vínculo, telão, anônimo); E2E (403 no PDF para o avaliador) |
| 17 | Reconexões e tentativas duplas sem duplicidade nem perda | VALIDADO LOCALMENTE | `flow.test.ts` (início idempotente, envio idempotente, dois fechamentos simultâneos geram 1 registro, conflito de revisão); `realtime.test.ts` (reconexão). O fallback por polling e o rascunho offline estão implementados, mas **sem teste automatizado de queda de rede**. |
| 18 | Monitor, notebook, tablet, smartphone e telão, com controles acessíveis | PARCIAL: VALIDADO LOCALMENTE em viewport 1440×900 e 390×844 (sem rolagem horizontal nas três áreas, medido via Playwright). **PENDENTE** em dispositivos físicos, projetor real e leitores de tela. | |
| 19 | Votação abre ao iniciar, opções configuráveis, sem voto duplicado, apuração separada | VALIDADO LOCALMENTE | `flow.test.ts` (unicidade, opção inválida, obrigatoriedade, apuração); `domain.test.ts` (regras); E2E (votos registrados pela UI) |
| — | PDF legível com quebras de página | VALIDADO LOCALMENTE (programaticamente) | `pdf.test.ts` (várias páginas, nenhum texto perdido). **PENDENTE** a inspeção visual humana do layout. |
| — | Rubrica do Projeto Integrador (anexo) e PDF no mesmo formato, preenchido | VALIDADO LOCALMENTE | `pi.test.ts`; `pi-flow.spec.ts`; páginas renderizadas e conferidas visualmente durante o desenvolvimento |
| — | Professores escalados por dia (repetindo ou não; configurações diferentes por dia) | VALIDADO LOCALMENTE | `pi.test.ts` › "escala de professores por dia" e "dias de participação no cadastro do professor"; `config-flow.spec.ts` |
| — | Local = sala + local da escola, com modelo de escrita configurável | VALIDADO LOCALMENTE | `pi.test.ts` › "local impresso" e texto do PDF |
| — | Tela inicial com três acessos diretos, sem menu de áreas | VALIDADO LOCALMENTE | `navigation.spec.ts` |
| — | Telão minimalista (sem cabeçalho, barra que some, leitura a distância) | VALIDADO LOCALMENTE | `navigation.spec.ts`, `demo-flow.spec.ts`; capturas conferidas visualmente durante o desenvolvimento. **PENDENTE** em projetor real. |
| — | Banca de cenários (um grupo em cada situação) e roteiro de preparação | VALIDADO LOCALMENTE | `scenarios.test.ts`, `navigation.spec.ts` |
| — | Telão sem seleção: segue o dia ativado pelo primário; grupo só após "Iniciar"; "Aguardando" na troca | VALIDADO LOCALMENTE | `scenarios.test.ts` › "telão"; `demo-flow.spec.ts`; `navigation.spec.ts` |
| — | Contagem 10 … 0 no telão e na tela dos professores; avaliador sem controles | VALIDADO LOCALMENTE | `countdown.test.ts`; `demo-flow.spec.ts`; capturas conferidas visualmente |
| — | Palmas ao estourar o tempo | PARCIAL: VALIDADO LOCALMENTE o disparo no TEMPO ENCERRADO (`demo-flow.spec.ts`). **PENDENTE** a audição em caixa de som real (o teste automatizado não ouve áudio). | |
| — | Grupo com resumo, orientadores, PDF, apresentação, link e cor de identificação | VALIDADO LOCALMENTE | `materials.test.ts`; `config-flow.spec.ts` |
| — | Professor: modal com resumo, orientadores, ler/baixar PDF e ver slides | VALIDADO LOCALMENTE | `config-flow.spec.ts`, `demo-flow.spec.ts`; PDF exibido dentro do modal conferido por captura no Chromium completo. Exibição de links externos (Google, Canva…) depende do site de origem: **PENDENTE** com links reais. |
| — | Avaliador aguarda (antes ou depois do primário) com a lista do dia em ordem | VALIDADO LOCALMENTE | `config-flow.spec.ts`, `demo-flow.spec.ts` |
| — | Tipo de rubrica com várias rubricas, vinculado à banca (e ao grupo) | VALIDADO LOCALMENTE | `materials.test.ts`, `demo.test.ts`, `config-flow.spec.ts` |
| — | Menu da Configuração na ordem de preenchimento | VALIDADO LOCALMENTE | `config-flow.spec.ts` (ordem das 8 etapas e "Próxima etapa"); `navigation.spec.ts` (endereço antigo `?secao=cronograma` continua funcionando) |
| — | Execução contra servidor PostgreSQL (`DATABASE_URL`) | **PENDENTE** | Implementado; não executado neste ambiente. |
| — | Implantação em servidor | **PENDENTE** | Não realizada. |
| — | Docker | **BLOQUEADO** | O daemon Docker não estava em execução; nenhum Dockerfile foi validado, por isso não foi fornecido. |

## Estrutura

```
shared/              domínio puro compartilhado (cronômetro, pontuação, cronograma, votos)
server/src/
  app.ts, index.ts   montagem do Fastify, segurança, estáticos
  db/                adaptador pg/PGlite, migrações SQL, seed fictício, CLI
  auth/              senhas (scrypt), sessões, autorização por dia
  services/          timer (autoritativo), schedule (inclui tipo de rubrica por grupo), evaluations, closure, readiness, display
  routes/            auth, live (cronômetro), professor, closure (PDF), admin, realtime (/ws)
  pdf/report.ts      geração do PDF
server/test/         Vitest
web/src/             React: pages (Cronometro, Professor, Configuracao + abas), components, lib
e2e/                 Playwright
docs/API.md          rotas, autorização e eventos em tempo real
```
