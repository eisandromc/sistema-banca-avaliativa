# API e eventos em tempo real

Base: `/api`. Respostas em JSON (exceto PDFs). Erros: `{ "error": "mensagem em pt-BR", "code": "CODIGO", "details"?: ... }`.

**Autenticação:** cookie de sessão `banca_sid` (assinado, `HttpOnly`, `SameSite=Lax`, `Secure` quando `COOKIE_SECURE=true`). O token é guardado no banco apenas como hash SHA-256.

**CSRF:** toda requisição que não seja `GET`/`HEAD` precisa do cabeçalho `x-banca-csrf: 1`. Sem ele, o servidor responde 403 `CSRF`.

**Autorização:** é verificada no servidor em cada rota. Legenda das colunas de acesso:

- **Admin:** administrador.
- **Prim.:** professor primário *do dia em questão*.
- **Aval.:** docente com atribuição no dia/grupo.
- **Telão:** perfil "Visualização do cronômetro".
- **Anônimo:** sem login.

| Código HTTP | Quando |
| --- | --- |
| 400 | Validação (`VALIDATION`, `BAD_REQUEST`, `CHECK`) |
| 401 | Sem sessão |
| 403 | Sem permissão / CSRF |
| 404 | Inexistente |
| 409 | Conflito: duplicidade, revisão desatualizada (`REVISION_CONFLICT`), já fechado (`ALREADY_CLOSED`), outra apresentação ativa (`ANOTHER_ACTIVE`), seleção de outro grupo com apresentação em andamento (`PRESENTATION_ACTIVE`), versão de rubrica em uso (`VERSION_IN_USE`) |
| 429 | Excesso de tentativas de login |

## Autenticação

| Método e rota | Acesso | Descrição |
| --- | --- | --- |
| `POST /auth/login` `{email, password}` | público | Cria a sessão (até 10 tentativas por IP+e-mail a cada 10 min). |
| `POST /auth/logout` | sessão | Encerra a sessão. |
| `GET /auth/me` | público | `{ user, primaryDayIds }` |
| `POST /auth/password` `{current, next}` | sessão | Troca a própria senha. |

## Cronômetro (área 1) e controle da sessão

| Método e rota | Acesso | Descrição |
| --- | --- | --- |
| `GET /public/days` | anônimo (bancas públicas) / logado | Dias disponíveis para a projeção. |
| `GET /days/:id/live` | Admin, Prim., Aval., Telão; anônimo se `public_display` | Estado público: grupo atual (alunos só se permitido), timer `{status, stages, elapsedMs, speed}`, etapas planejadas, próximo grupo, `serverNow`. **Sem notas nem comentários.** |
| `POST /days/:id/select` `{entryId}` | Admin, Prim. | Seleciona o grupo atual. Bloqueado (`409 PRESENTATION_ACTIVE`) enquanto outro grupo estiver em apresentação (em execução ou pausado): encerre-a antes. |
| `POST /days/:id/timer/start` `{entryId}` | Admin, Prim. | Inicia a apresentação, copia as etapas do perfil, marca **Iniciado** (`started_at`) e **abre as fichas** dos docentes designados. Idempotente: `{alreadyStarted:true}` se já em andamento. |
| `POST /days/:id/timer/pause` / `resume` | Admin, Prim. | Idempotentes (`noop:true`). |
| `POST /days/:id/timer/advance` | Admin, Prim. | Pula para o início da próxima etapa (na última, encerra o tempo). |
| `POST /days/:id/timer/finish` `{reason?}` | Admin, Prim. | Encerra antes do prazo. |
| `POST /days/:id/timer/adjust` `{stages[], reason}` | Admin, Prim. | Ajusta as etapas da sessão em curso (o perfil global não muda); auditado. Se o tempo havia esgotado e o total aumentou, a sessão volta a "Pausado". |
| `POST /days/:id/timer/restart` `{reason}` | Admin, Prim. | A sessão vigente vira histórico (`superseded`); o grupo pode ser iniciado de novo. As fichas são preservadas. |

## Professor (área 2)

| Método e rota | Acesso | Descrição |
| --- | --- | --- |
| `GET /me/days` | logado | Dias em que o usuário atua (o administrador vê todos). |
| `GET /days/:id/workspace` | Admin, Prim., Aval. | Cronograma (com situação, check Iniciado, horários previstos e reais, `color` de cada grupo), grupo atual (com `advisors[]` e `hasMaterials`), a ficha **do próprio usuário** e, para Prim./Admin, o progresso das fichas (situação, nunca notas). |
| `GET /groups/:id/project` | Admin, Prim., Aval. do dia do grupo | Resumo e materiais: `{code, className, title, summary, advisors[], students[], projectUrl, pdfUrl, slidesUrl, githubUrl, slidesFile, articleFile, color, position, rubricTypeName}`. Quem não atua no dia recebe 403. |
| `GET /evaluations/:id` | **somente o dono** | Ficha: rubrica, notas, comentários, perguntas de votação e voto, `editable`. |
| `PUT /evaluations/:id/draft` `{revision, generalComment?, scores[], votes[]?}` | dono | Rascunho. `score: null` = sem nota (diferente de 0). Valida escala e incremento. 409 `REVISION_CONFLICT` se a revisão estiver desatualizada; 409 `LOCKED` se a ficha estiver enviada (política `locked`) ou fechada. |
| `POST /evaluations/:id/submit` `{revision}` | dono | Envia; 400 com a lista de pendências. Idempotente para a mesma revisão. |

## Conferência, fechamento e PDF

| Método e rota | Acesso | Descrição |
| --- | --- | --- |
| `GET /groups/:id/review` | Admin, Prim. do dia do grupo | `{ consolidation, closed (snapshot vigente), history, isAdmin }`. A consolidação traz notas, pesos, contribuições, comentários, votos/apuração, exceções, `finalScore` e `blockers`. |
| `PUT /groups/:id/verdict` `{verdict, strengths, improvements, guidance}` | Admin, Prim. | Parecer da banca (só opções configuradas na banca). Obrigatório para fechar quando a banca define opções; bloqueado após o fechamento. |
| `POST /groups/:id/close` `{confirm:true}` | Admin, Prim. | Fecha se não houver bloqueios. Grava snapshot imutável com versão, autor e data. Uma segunda chamada recebe 409 `ALREADY_CLOSED`. |
| `POST /groups/:id/reopen` `{reason}` | **Admin** | Reabre (motivo com mín. 10 caracteres). O snapshot anterior fica no histórico, as fichas voltam a rascunho e o próximo fechamento recebe a versão +1. |
| `POST /groups/:id/exceptions` `{kind, evaluationId, criterionId?, reason}` | **Admin** | `evaluator_absent` (o avaliador sai da base de cálculo) ou `criterion_waived`. |
| `POST /exceptions/:id/revoke` | Admin | Revoga a exceção (antes do fechamento). |
| `GET /groups/:id/report.pdf[?version=N]` | Admin, Prim. | PDF individual gerado a partir do snapshot do fechamento. |
| `GET /days/:id/report.pdf` | Admin, Prim. | Lote com todos os projetos fechados do dia. |

## Configuração (área 3, administrador)

As rotas de grupos, cronograma, votação, atribuições, eventos do cronômetro e acompanhamento estão abaixo.

- **Visão geral:** `GET /admin/overview`.
- **Usuários:** `GET/POST /users`, `PATCH /users/:id` (nome, e-mail, perfil, ativo, senha). Desativar a conta ou trocar a senha encerra as sessões do usuário. `GET /users` inclui os dias em que cada professor participa.
- **Dias de participação do professor:** `GET /users/:id/days` lista todos os dias, com `eventId`, `eventTypeId`, `assigned`, `rubricPosition`, `isPrimary` e `hasEvaluations`. `PUT /users/:id/days {days:[{dayId, rubricPosition}]}` define a lista completa de dias e a ficha de cada um (posição no tipo de rubrica da banca; 400 se não existir): cria, atualiza ou remove a atribuição geral do dia. Responde 409 ao tentar remover um dia em que o professor já tem fichas ou é o primário.
- **Bancas:** `GET/POST /events`, `PUT/DELETE /events/:id`. Os campos são:
  - `name`, `institution`, `period`, `timezone` (padrão `America/Sao_Paulo`);
  - `reportHeader`, `reportSubtitle`, `reportFooter`, `reportColor`;
  - `showStudentNames`, `publicDisplay`;
  - `warnPct`, `dangerPct`;
  - `editAfterSubmit` (`locked` | `until_closure`);
  - `votePrivacy` (`nominal` | `anonymous`);
  - `institutionDetail`, `reportPurpose`, `reportGuidance` (textos do documento);
  - `schoolLocation` e `locationFormat` (Local impresso = modelo com `{sala}` e `{escola}`);
  - `aggregation` (`mean`: média das avaliações normalizadas; `sum`: soma dos subtotais);
  - `verdictOptions[]` (opções do parecer da banca; vazio = sem parecer);
  - `rubricTypeId` (tipo de rubrica da banca, ou `null`).
- **Logotipo:** `PUT /events/:id/logo {dataUrl|null}` (PNG/JPEG em data URL, até ~1,5 MB) e `GET /events/:id/logo`.
- **Modelo Projeto Integrador:** `POST /templates/projeto-integrador {eventId|null}` instala o tipo "Projeto Integrador" com as 4 rubricas (idempotente) e, se `eventId` for informado, vincula o tipo à banca e aplica soma, parecer e textos.
- **Copiar escala:** `POST /days/:id/assignments/copy {fromDayId, includePrimary}`.
- **Telão:** `GET /public/display` → `{display: {dayId, label, date, room, eventId, eventName, activatedAt} | null, restricted}`. Sem login, só retorna banca com exibição pública; caso contrário, `restricted: true`. `POST /days/:id/display {active}` (primário do dia ou administrador) ativa o dia, substituindo o anterior, ou o desativa. O primeiro `timer/start` ativa o dia automaticamente quando nenhum está ativo. WebSocket: `{type:"subscribe-display"}` recebe `{type:"display-changed"}` a cada troca.
- **Roteiro de preparação:** `GET /events/:id/readiness` → `{checks[], days[{dayId, label, date, room, checks[], progress{total, started, finalized, running}}], summary{ok, warn, todo, ready}}`. Cada item tem `key`, `label`, `status` (`ok` | `warn` | `todo`), `detail` e `tab` (seção da Configuração onde o item se resolve). Somente administrador.
- **Dias:** `POST /events/:id/days`, `PUT/DELETE /days/:id`. Os campos são `label`, `date`, `startTime`, `endTime`, `room`, `gapMinutes`, `defaultProfileId` e `breaks[{label,start,end}]`. O servidor valida a ordem dos horários, intervalos fora do dia e sobreposição de intervalos.
- **Professor primário:** `PUT /days/:id/primary {userId|null, rubricPosition, reason?}` (no máximo um por dia; auditado). O primário também avalia: `rubricPosition` (a ficha) é obrigatório ao designar e cria ou atualiza a atribuição dele para todos os grupos do dia.
- **Perfis de tempo:** `GET/POST /profiles`, `PUT/DELETE /profiles/:id`, `POST /profiles/:id/duplicate`.
- **Grupos:** `GET/POST /events/:id/groups`, `PUT/DELETE /groups/:id`. Campos:
  - `code`, `className`, `title`, `students[]`;
  - `description` (resumo do projeto, até 4000 caracteres);
  - `advisors[]` (professores orientadores, até 6; o campo antigo `advisor` ainda é aceito e vira o primeiro item);
  - `projectUrl` (`https://…`), `pdfUrl` e `slidesUrl` (`https://…` ou caminho do sistema como `/demo/x.pdf`); outros esquemas recebem 400;
  - `githubUrl` (repositório do projeto; só `https://github.com/…`, outros endereços recebem 400);
  - `color` (`#rrggbb`; se omitido na criação, o servidor escolhe a cor da paleta menos usada na banca e a devolve; na edição, mantém a atual);
  - `rubricTypeId` (tipo de rubrica próprio do grupo, ou `null` para usar o da banca).
- **Distribuição:** `POST /groups/:id/place {dayId|null, position?}` coloca o grupo no dia (na posição 1-based; sem posição, no fim), move entre dias (levando as atribuições específicas do grupo), reordena no mesmo dia ou, com `dayId: null`, tira do cronograma e renumera o dia. Operação atômica; grupo já iniciado não muda de dia (409 `STARTED`).

| Cronograma | |
| --- | --- |
| `GET /days/:id/schedule` | Previsões, avisos (estouro, falta de perfil), situação. Admin ou Prim. |
| `POST /days/:id/schedule` `{groupId, timeProfileId?}` | Inclui grupo no dia (um grupo só pode estar em uma entrada). |
| `PUT /days/:id/schedule/order` `{entryIds[]}` | Reordena (409 `STALE_ORDER` se a lista não corresponder). |
| `POST /days/:id/schedule/sort` `{by: code\|class\|title}` | Ordena por critério. |
| `PATCH /schedule-entries/:id` `{timeProfileId?, dayId?}` | Perfil próprio do grupo / mover de dia (não iniciado). |
| `DELETE /schedule-entries/:id` | Remove do dia (não iniciado). |

| Rubricas | |
| --- | --- |
| `GET /rubrics` | `types[]` (tipos com uso) e `templates[]` (rubricas com `typeId`, `typePosition`, versões, critérios e uso). |
| `POST /rubrics` `{name, description?, typeId?, version}` | Cria a rubrica (modelo + v1); com `typeId`, entra no fim do tipo. |
| `PATCH /rubric-templates/:id` `{name?, description?, typeId?, typePosition?}` | Renomeia, move para outro tipo (vai para o fim) ou muda a posição dentro do tipo. |
| `POST /rubric-types` `{name, description?}` / `PUT /rubric-types/:id` | Tipo de rubrica (nome único, sem diferenciar maiúsculas). |
| `DELETE /rubric-types/:id` | Só se nenhuma banca ou grupo usar o tipo (409 `IN_USE`); as rubricas ficam sem tipo. |
| `PUT /rubric-versions/:id` | Edita **somente** versão nunca usada (409 `VERSION_IN_USE`). |
| `POST /rubric-versions/:id/new-version` | Nova versão (número + 1). |
| `DELETE /rubric-versions/:id` | Só se não usada nem atribuída. |

Versão de rubrica: `title`, `instructions` (responsabilidade), `evaluatorRole`, `dimension`, `dimensionShort`, `feedbackLabel`, `scaleLabels[{value,label}]`, `sortOrder`, `scaleMin`, `scaleMax`, `scaleStep`, `normalization` (`null` \| `linear`, obrigatória fora de 0–10), `generalCommentRequired`, `criteria[{title, description, weight>0, required, commentEnabled, commentRequired}]`.

- **Votação:** `GET/POST /events/:id/vote-questions` e `PUT/DELETE /vote-questions/:id`.
  - Campos: `title`, `prompt`, `enabled`, `required`, `allowAbstain`, `rule` (`simple_majority` | `quorum` | `counts_only`), `quorumMin` e `options[{label, isAbstain}]`.
  - Depois de haver votos, as opções ficam bloqueadas e a pergunta não pode ser excluída (só desabilitada).
- **Atribuições:**
  - `GET/POST /days/:id/assignments` com `{userId, rubricPosition, groupId|null}`; `groupId` nulo vale para todos os grupos do dia, e uma atribuição específica de grupo sobrescreve a do dia. A atribuição guarda só a **ficha** (posição no tipo de rubrica); a rubrica vem do tipo do grupo (ou da banca), na versão mais recente, e a listagem traz o `rubricTitle` resolvido. Banca sem tipo ou ficha inexistente no tipo: 400.
  - `PATCH /assignments/:id {rubricPosition}`.
  - Tipo de rubrica: para um grupo cujo tipo (o do grupo ou o da banca) é diferente do tipo da rubrica atribuída ao dia, a ficha usa a rubrica da **mesma posição** no tipo do grupo (versão mais recente). Atribuições específicas do grupo e rubricas sem tipo não são trocadas.
  - `DELETE /assignments/:id` é bloqueado (409) se o docente já tiver fichas sob a atribuição; nesse caso, registre a ausência como exceção no fechamento.
- **Acompanhamento:** `GET /days/:id/monitor`, `GET /days/:id/timer-events`.
- **Auditoria:** `GET /audit?limit=&entity=&action=` (o filtro `action` busca por prefixo).

## Canal em tempo real — `GET /ws` (WebSocket)

O cliente conecta (com cookie, se logado) e envia `{"type":"subscribe","dayId":N}`. A autorização é a mesma de `GET /days/:id/live`.

| Mensagem do servidor | Conteúdo |
| --- | --- |
| `hello` | `{serverNow}` |
| `subscribed` | `{dayId}` |
| `live` | `{dayId, state}`: mesmo formato de `GET /days/:id/live`. É enviada em toda ação de controle, em cada troca automática de etapa, no fim do tempo e a cada 10 s (ressincronização). |
| `day-changed` | `{dayId, reason}`: sinal para recarregar via REST. Motivos: `group_selected`, `timer_*`, `evaluation_submitted`, `closed`, `reopened`, `reordered`, `primary_changed`, `time_up`. |
| `evaluations-opened` | `{dayId, entryId, groupId}`: as fichas do grupo foram liberadas. |
| `error` | `{error}` |

As mensagens **nunca** contêm notas, comentários ou votos. Cada cliente busca os próprios dados pelo REST, com sua autorização.

O servidor envia ping a cada 25 s. O cliente reconecta com backoff exponencial (1 s a 15 s) e, se a reconexão demorar mais de 2,5 s, passa a consultar `GET /days/:id/live` a cada 3 s até o socket voltar.

**Relógio:** o visor calcula `elapsedMs + (performance.now() − recebidoEm) × speed` entre as mensagens. Usa apenas tempo monotônico, nunca o horário do navegador.

## Lixeira — `/api/trash` (administrador)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/trash` | Lista itens excluídos: `{items:[{kind,kindLabel,id,name,context,deletedAt,deletedBy}]}` |
| POST | `/api/trash/:kind/:id/restore` | Restaura (409 se o pai estiver excluído ou o código/nome já estiver em uso) |
| DELETE | `/api/trash/:kind/:id` | Exclusão definitiva (UPDATE `purged_at`; irrecuperável) |
| DELETE | `/api/trash` | Limpa a lixeira |

`kind`: `event`, `day`, `profile`, `group`, `group_file`, `rubric_type`, `rubric_version`, `vote_question`, `user`. Os `DELETE` de recursos comuns agora movem o item
para a lixeira; perfis e tipos excluídos ainda vinculados aparecem nas listagens com `deleted: true`.
- `DELETE /api/users/:id` — exclui (lixeira) um usuário; não pode ser a própria conta; encerra as sessões dele.
