# Auditoria de UX/UI — Gestão de Bancas

Data: 11/10/2026. Revisão independente de DaVinci e Dev, consolidada com navegação e testes locais. Objetivo: facilitar o uso e a interpretação dos dados.

**Parecer:** o cronômetro tem boa hierarquia visual e os fluxos principais funcionam nos testes existentes. A administração ainda exige esforço excessivo para localizar tarefas e interpretar contexto. Antes de aprimorar a aparência, é necessário corrigir a correspondência entre os dados apresentados, confirmados e gravados: reproduzimos envio de nota antiga após falha de salvamento e conferência de grupo pertencente a outro dia.

Esta entrega é uma auditoria e uma proposta de evolução. Nenhum código-fonte da aplicação foi alterado para corrigir os achados. Interações que alteraram dados usaram um servidor de demonstração separado, na porta 3300, com banco PGlite em memória; a instância existente na porta 3000 não foi usada para essas interações.

## Cobertura e evidências

- Leitura de App, Login, Professor, Cronômetro, Configuração, todas as 12 abas administrativas, componentes, bibliotecas e serviços relacionados aos achados.
- Navegação das 12 abas em Chromium, com 1440 × 900 e 390 × 844; verificações adicionais em 768 × 1024.
- Fluxo de início de apresentação, telão, ficha de avaliação, confirmação e envio; reprodução de falha HTTP no salvamento.
- Dois dias do Projeto Integrador com apresentações iniciadas para testar a troca de contexto no fechamento.
- Simulação de erro na leitura da participação de professor; captura da tentativa de gravação sem aplicar a alteração dos dias.
- `npm.cmd run build`: passou, incluindo TypeScript de servidor e frontend.
- `npm.cmd test`: 52 testes passaram em 5 arquivos.
- `npm.cmd run test:e2e`: 4 testes passaram, incluindo configuração, fluxo completo, redução de movimento e Projeto Integrador/PDF.

Os testes existentes passam, mas não cobrem os principais cenários adversos encontrados nesta auditoria. Houve ajustes de seletores nos scripts exploratórios; o primeiro levantamento terminou por timeout de um seletor de botão. O fluxo foi retomado e concluído em execução separada, sem erros registrados nessa execução.

Evidências: [levantamento das telas](ux-evidence/observations.json), [reprodução do envio](ux-evidence/flow-observations.json), [troca de dia e erro de participação](ux-evidence/context-observations.json). As capturas usam apenas dados fictícios.

## Prioridades confirmadas no navegador

### 1. P1 — A confirmação pode enviar uma nota diferente da exibida

**Reprodução:** salvar uma ficha completa com nota 5; alterar “Domínio técnico” para 9; simular HTTP 500 nos PUTs de rascunho; clicar em Enviar e Confirmar envio. O resumo mostrou **9,0**, o POST de envio retornou **200**, a aplicação exibiu ficha enviada e recarregou a nota **5**. Duas tentativas de salvamento foram bloqueadas na simulação.

**Causa:** `EvaluationForm.tsx:190` captura o erro sem propagá-lo; `flush():241` não exige sucesso; `:567–569` permite enviar a revisão antiga e limpar o rascunho local.

**Recomendação:** bloquear envio até confirmar a persistência exata do conteúdo mostrado; propagar falhas de `flush`; preservar rascunho em qualquer falha. Uma operação atômica de salvar/enviar reduz a janela de inconsistência.

**Aceite:** nota exibida no resumo = nota enviada = nota recuperada após recarregar, inclusive em falha/reconexão. Falha deve manter edição recuperável e apresentar nova tentativa.

### 2. P1 — Trocar o dia mantém a conferência do grupo anterior

**Reprodução:** selecionar explicitamente PI-01 na conferência do Dia 1; mudar para Dia 2. A navegação lateral passou a mostrar PI-03, mas a conferência continuou exibindo PI-01. [Captura](ux-evidence/desktop-closure-wrong-day.png).

**Causa:** `config/Closure.tsx:19–23` preserva `groupId` e o prioriza sem validar se pertence ao novo dia; `:43` mantém o Review correspondente.

**Recomendação:** reiniciar e validar a seleção quando banca/dia mudarem; não habilitar ações enquanto contexto e dados não coincidirem; incluir banca, dia e grupo no cabeçalho da confirmação.

**Aceite:** nunca existir seletor de um dia com dados ou ações de outro, mesmo sob latência. Nesta reprodução não foi realizado fechamento do grupo errado; a inconsistência de exibição foi confirmada.

### 3. P1 — Erro ao carregar a participação do professor permite enviar uma escala vazia

**Reprodução:** simular HTTP 500 em GET `/api/users/:id/days` ao editar Bruno. Nenhum dia ficou marcado; o erro de leitura não apareceu; Salvar permaneceu habilitado. A gravação tentou enviar `{ "days": [] }`. O PUT foi interceptado e não aplicado.

**Causa:** `config/Teachers.tsx:245–267` transforma ausência de dados em lista vazia; `:372–382` permite salvar. O backend remove atribuições ausentes, com proteções específicas para primário e dias com fichas (`routes/admin.ts:369–371`).

**Recomendação:** distinguir erro de leitura de ausência de participação; bloquear salvamento dessa seção até uma leitura válida; enviar alterações de escala somente quando editadas.

**Aceite:** editar nome/e-mail após falha de leitura nunca deve remover participação em dias. A remoção efetiva não foi executada; a tentativa de payload vazio foi confirmada.

### 4. P2 — Há conteúdo fora da largura disponível em quatro abas no celular

Larguras medidas no documento em viewport de 390 px:

| Aba | Largura do conteúdo | Consequência |
| --- | ---: | --- |
| Bancas e dias | 444 px | Conteúdo excede a tela |
| Grupos e alunos | 453 px | Conteúdo excede a tela |
| Rubricas | 487 px | Colunas comprimidas e conteúdo lateral |
| Professores e atribuições | 877 px | Interface mais que duas vezes a largura disponível |

Professores também atingiu 877 px no tablet de 768 px. A folha global usa `overflow-x: hidden` no body, o que não resolve a causa e pode ocultar conteúdo. A tabela de rubricas não tem o contêiner de rolagem empregado em outras áreas (`Rubrics.tsx:114`). [Rubricas](ux-evidence/mobile-rubrics-viewport.png), [Professores](ux-evidence/mobile-teachers-viewport.png).

**Recomendação:** corrigir dimensionamento dos filhos de flex/grid, limitar seletores longos e oferecer cartões/resumos no celular. Tabelas que precisem manter colunas devem ter rolagem própria perceptível. Verificar também a 320 px e com zoom; a WCAG admite exceção para tabelas bidimensionais, sem estendê-la automaticamente à página inteira. [Referência W3C sobre reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

### 5. P2 — Navegação esconde etapas essenciais

As 12 abas ocupam **1668 px**. A área disponível é 1408 px no desktop e 358 px no celular. Relatórios e auditoria ficam fora da região inicial; o usuário precisa descobrir a rolagem horizontal. A seção ativa não possui URL própria, apenas estado/localStorage (`Configuracao.tsx:76–90,135,203`; `styles.css:657`).

**Recomendação:** preservar as três áreas principais existentes e reorganizar a navegação interna de Configuração em **Preparação, Operação e Resultados**. Usar lista lateral no desktop e seletor de seção no celular; refletir seção/banca/dia na URL.

### 6. P2 — Indicadores globais parecem pertencer à banca selecionada

A tela mostra seletores de uma banca/dia e, logo abaixo, contagens de todas as bancas. Na demonstração, selecionar a banca do Projeto Integrador exibia “2 Bancas”, “3 Dias” e “5 Grupos”. O endpoint de Overview não recebe filtros (`Overview.tsx:16`; `routes/admin.ts:229–236`). [Captura](ux-evidence/desktop-overview.png).

**Recomendação:** declarar claramente o escopo de cada tela e retirar filtros que não se aplicam. Na entrada operacional, mostrar prontidão do dia, grupos aguardando, fichas pendentes, grupos prontos para fechar e término previsto. Cada número deve abrir a lista correspondente. O roteiro de preparação deve indicar tarefas concluídas e pendentes, com ações diretas.

### 7. P2 — Densidade e organização das tabelas dificultam a leitura rápida

No acompanhamento mobile, duas linhas de grupos produziram uma página de 1728 px; dados importantes ficaram em colunas laterais. Rubricas chegou a 7642 px com seis modelos abertos. Em Professores, participação em várias bancas aparece como longas sequências de texto. [Acompanhamento mobile](ux-evidence/mobile-tab-8.png), [Professores desktop](ux-evidence/desktop-tab-7.png).

**Recomendação:** no acompanhamento, resumir cada grupo com horário, estado e “enviadas/esperadas”; detalhes por professor sob expansão. Destacar pendências e atraso antes do histórico. Em rubricas, mostrar lista compacta de modelos e abrir um por vez. Em professores, separar cadastro de contas da escala do dia e apresentar participações em lista curta expansível.

## Riscos adicionais rastreados no código

Estes cenários têm evidência estática, mas não foram reproduzidos individualmente nesta revisão.

| Prioridade | Achado e evidência | Recomendação |
| --- | --- | --- |
| P1 | Parecer alterado depois de salvo pode permanecer visualmente atualizado após fechamento, enquanto o snapshot/PDF guarda o texto anterior. `Review.tsx:13,125,205,311`. | Detectar alterações pendentes; salvar ou descartar explicitamente antes de fechar; exibir parecer fechado diretamente do snapshot. |
| P1 | Conferência não é vinculada à revisão dos dados. Outro avaliador pode alterar/reenviar entre leitura e fechamento; o servidor consolida novamente. `Review.tsx:65,311`; `services/closure.ts:353`. | Invalidar resumo após atualização e exigir revisão/hash da conferência no fechamento. |
| P1 | Cronômetro pode preservar `live` do dia anterior e combinar esse estado com comandos destinados ao novo dia. `lib/realtime.ts:30–38,116`; `Cronometro.tsx:89`. | Limpar dados na troca, descartar respostas antigas e exigir coincidência de IDs antes de habilitar controles. |
| P2 | A troca remota de grupo substitui automaticamente a ficha em edição e cancela autosave pendente no desmontar. `Professor.tsx:86,178`; `EvaluationForm.tsx:137`. | Preservar a ficha em edição e anunciar o novo grupo com ação explícita para trocar. |
| P2 | Rascunho offline é anunciado como protegido mesmo se `localStorage` falhar. `EvaluationForm.tsx:14,35,237`. | Verificar persistência local e distinguir alterações apenas em memória de alterações recuperáveis. |
| P2 | “Sair” limpa o estado visual mesmo quando logout falha. `lib/auth.tsx:46–47`. | Informar falha e permitir nova tentativa; confirmar encerramento apenas após resposta válida. |
| P2 | Cancelar ajuste de tempos não reinicializa os valores na reabertura. `TimerControls.tsx:54,96,104`. | Criar rascunho novo a partir da sessão atual ao abrir. |
| P2 | Edição longa de banca/rubrica pode ser descartada ao fechar o modal; ações ficam no fim. `Events.tsx:130`; `Rubrics.tsx:183`; `styles.css:572,608`. | Separar seções, manter ações visíveis e proteger fechamento com alterações pendentes. |
| P2 | Linhas inválidas de rótulos da escala são descartadas silenciosamente. `Rubrics.tsx:32–41,180,290`. | Editor por valor/rótulo, validação por linha e prévia da escala. |
| P2 | Falhas de perfis/usuários parecem listas vazias; busca sem resultado diz que não há grupos cadastrados. `Configuracao.tsx:163–165`; `Groups.tsx:37,50–51`. | Estados distintos para carregamento, erro, cadastro vazio e busca sem resultado. |
| P2 | Auditoria expõe códigos técnicos e JSON, limita consulta a 300 registros sem navegação equivalente. `Audit.tsx:9,21,51,56`. | Ações em português, filtros por pessoa/período/contexto, resumo legível e paginação explícita. |

A confirmação deve permitir revisar e corrigir os dados efetivamente enviados. O critério de prevenção de erros da W3C é referência pertinente para esse desenho; esta auditoria não constitui certificação de conformidade. [W3C — prevenção de erros](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html).

## Direção proposta para a experiência

**Administrador:** entrar em “Situação do dia”, com contexto explícito e pendências acionáveis. Preparar banca/dias, grupos, rubricas e escala por uma sequência verificável. Durante a sessão, ver grupo atual, andamento, fichas e atrasos. Acessar fechamento e relatórios sem procurar em uma faixa extensa de abas.

**Professor avaliador:** identificar imediatamente grupo e rubrica; manter a ficha como conteúdo principal. Usar cronômetro compacto, progresso dos critérios e salvamento verificável. No celular, reduzir o espaço ocupado por cabeçalho e repetição de informações antes dos campos. Preservar a edição quando outro grupo iniciar.

**Professor primário:** manter controles da sessão e próximo grupo facilmente acessíveis. Exibir pendências por avaliador em resumo curto, com detalhes sob demanda. Antes de fechar, confirmar contexto e versão exata dos dados.

**Telão:** preservar a hierarquia atual — grupo, etapa, tempo restante e próxima etapa. O cronômetro foi o ponto visual mais claro observado, tanto em desktop claro quanto no recorte de tablet escuro. [Desktop](ux-evidence/desktop-timer.png), [tablet escuro](ux-evidence/tablet-timer-dark.png). Testar separadamente legibilidade à distância em projetor real.

**Visualização dos dados:** priorizar contagens com denominador, situação e ação. Exemplos de rótulos: “Fichas enviadas: 3 de 4”, “1 grupo pronto para fechar”, “Término previsto: 12:40 · 10 min além do planejado”. São propostas de conteúdo, não números medidos nesta banca. Usar barras simples apenas quando facilitarem a comparação; notas individuais e votos devem continuar separados e rastreáveis. No fechamento, resumir pendências por professor antes de expandir os critérios ausentes; o bloco atual pode ocupar quase toda a tela com texto repetido.

## Ordem recomendada e critérios de aceite

1. **Integridade e contexto:** corrigir envio após falha, parecer, revisão da conferência, seleção de dia e leitura da escala docente. Testar falhas de rede, duas sessões e alternância de contexto. Nenhuma confirmação pode produzir dados diferentes dos revisados.
2. **Responsividade e navegação:** eliminar conteúdo inacessível, revisar tabelas mobile, agrupar seções e criar URLs estáveis. Verificar 320, 390, 768 e 1440 px, teclado e zoom, incluindo formulários abertos e dados longos.
3. **Leitura operacional:** substituir inventário na entrada por prontidão e pendências; resumir acompanhamento; separar contas de escala; reduzir densidade da conferência.
4. **Validação com usuários:** observar administrador preparando um dia, avaliador preenchendo pelo celular e primário conduzindo/fechando uma banca. Medir conclusão sem ajuda, erros de contexto, tempo para localizar pendências e capacidade de explicar o resultado. Metas devem ser definidas após essa linha de base, sem inventar notas de usabilidade.

## Pontos fortes a preservar

- Três áreas principais compreensíveis e cronômetro com números grandes, etapas e redundância de texto/cor.
- Rótulos de campos, foco visível, link para pular conteúdo e componentes Radix nos diálogos/abas.
- Alternativa de movimento reduzido, coberta pelo E2E.
- Zero distinto de nota não preenchida, explicação de escala/peso, pendências e resumo antes de enviar.
- Rubricas versionadas, histórico de fechamento, apresentação de cálculo e PDF derivado de snapshot.
- Cronograma com alternativas a arrastar e soltar, incluindo botões e teclado no código.

## Limitações e registro da revisão

Não houve teste com usuários reais, leitores de tela, dispositivos físicos, projetor, medição sistemática de contraste ou auditoria WCAG completa. Tema escuro foi inspecionado apenas no cronômetro. Os PDFs passaram pelos testes existentes; seu layout não foi renderizado nem revisado nesta rodada. Não foram exercitados todos os formulários, todas as combinações de permissões ou alto volume de dados; as áreas correspondentes receberam leitura de código. Não se trata de auditoria completa de segurança/backend.

DaVinci (`/root/davinci`) e Dev (`/root/dev`) concluíram revisões independentes e somente de leitura. DaVinci cobriu arquitetura de informação, as 12 abas e CSS; Dev cobriu páginas principais, componentes, estados e serviços relacionados. A execução no navegador e das suítes foi realizada pelo agente principal, que confirmou três cenários críticos de interface/payload. Os demais riscos permanecem identificados como análise estática.
