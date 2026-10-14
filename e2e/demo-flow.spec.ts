import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Fluxo obrigatório de demonstração (dados fictícios do seed):
 * primária ativa o dia no telão → telão (sem seleção) mostra "Aguardando" → seleciona o Grupo 01 (telão segue
 * "Aguardando") e inicia → telão e docentes sincronizam e as fichas abrem sem recarregar →
 * etapas mudam (10 → 5 → 5 min, acelerado 60x) → TEMPO ENCERRADO → docentes avaliam, votam e enviam →
 * primária confere, fecha e baixa o PDF → passa ao Grupo 02 sem perder o Grupo 01.
 */

async function login(browser: Browser, email: string, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/login?voltar=${encodeURIComponent(path)}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await page.waitForURL((u) => u.pathname === path.split('?')[0]);
  return page;
}

async function fillEvaluation(page: Page, scores: Record<string, string>, vote: string) {
  for (const [label, value] of Object.entries(scores)) {
    await page.getByLabel(label, { exact: false }).first().fill(value);
  }
  const justif = page.getByRole('textbox', { name: /^Justificativa/ });
  const n = await justif.count();
  for (let i = 0; i < n; i++) await justif.nth(i).fill(`Comentário de teste ${i + 1}`);
  await page.getByLabel('Observações gerais do projeto').fill('Observação geral (teste E2E).');
  await page.getByRole('radio', { name: vote, exact: true }).check();
  await expect(page.getByText('Pronta para envio')).toBeVisible();
  await expect(page.getByText('Rascunho salvo no servidor')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar avaliação' }).click();
  await page.getByRole('button', { name: 'Confirmar envio' }).click();
  await expect(page.getByText('Ficha enviada').first()).toBeVisible();
}

test('fluxo completo da banca de demonstração', async ({ browser }) => {
  const ana = await login(browser, 'ana@demo.banca', '/professor?dia=1');
  const bruno = await login(browser, 'bruno@demo.banca', '/professor?dia=1');
  const carla = await login(browser, 'carla@demo.banca', '/professor?dia=1');
  const telaoCtx = await browser.newContext();
  const telao = await telaoCtx.newPage();

  // Telão (sem login): não há seleção de dia nem de grupo; segue o dia ativado pela primária.
  await telao.goto('/cronometro');
  await expect(telao.getByRole('button', { name: /Trocar dia/ })).toHaveCount(0);
  await expect(ana.getByText('Você é o(a) professor(a) primário(a)')).toBeVisible();
  await ana.getByRole('button', { name: /Ativar no telão|Trazer este dia para o telão/ }).click();
  await expect(ana.getByText('● Exibindo este dia')).toBeVisible();
  await expect(telao.getByRole('heading', { name: 'Aguardando' })).toBeVisible();
  await expect(telao.getByText(/Banca de Projetos — DEMONSTRAÇÃO · Dia 1/).first()).toBeAttached();

  // Primária seleciona o Grupo 01 → o telão continua em "Aguardando" até a apresentação ser iniciada.
  await ana.locator('.sched-item', { hasText: 'Grupo 01' }).getByRole('button', { name: 'Selecionar' }).click();
  await expect(ana.locator('#grupo-atual')).toBeVisible();
  await expect(ana.locator('.current-group')).toContainText('Grupo 01');
  await expect(telao.getByRole('heading', { name: 'Aguardando' })).toBeVisible();
  await expect(telao.locator('.timer-code')).toHaveCount(0);

  // Avaliador comum não vê controles: aguarda com a lista do dia em ordem (#, hora programada e cor do grupo).
  await expect(bruno.getByRole('button', { name: /Iniciar apresentação/ })).toHaveCount(0);
  await expect(bruno.getByRole('heading', { name: 'Aguardando o professor primário' })).toBeVisible();
  await expect(bruno.getByText('Próximo a se apresentar:')).toBeVisible();
  await expect(bruno.locator('.order-row').first()).toContainText('#1');
  await expect(bruno.locator('.order-row').first()).toContainText('Grupo 01');
  await expect(bruno.locator('.order-row').nth(1)).toContainText('#2');
  // Resumo, orientadores e materiais do projeto em modal.
  await bruno.getByRole('button', { name: 'Projeto de Grupo 01' }).click();
  await expect(bruno.getByRole('heading', { name: 'Resumo do projeto' })).toBeVisible();
  await expect(bruno.getByRole('dialog').getByText(/Orientador|Orientadora/).first()).toBeVisible();
  await bruno.getByRole('dialog').getByRole('button', { name: 'Ver apresentação' }).click();
  await expect(bruno.locator('iframe.viewer-frame')).toBeVisible();
  await bruno.getByRole('button', { name: 'Voltar ao projeto' }).click();
  await bruno.keyboard.press('Escape');
  await expect(bruno.getByRole('dialog')).toHaveCount(0);

  // Iniciar apresentação → o grupo aparece sozinho no telão.
  await ana.getByRole('button', { name: /Iniciar apresentação/ }).click();
  await expect(telao.locator('.timer-code')).toHaveText('Grupo 01');
  // Contagem regressiva 10 … 0 no telão e na tela dos professores antes de o tempo começar.
  await expect(telao.getByText('A apresentação começa em')).toBeVisible();
  await expect(telao.getByRole('timer', { name: /A apresentação começa em \d+/ })).toBeVisible();
  await expect(bruno.getByRole('timer', { name: /A apresentação começa em \d+/ })).toBeVisible();
  await expect(bruno.getByRole('button', { name: /Pausar|Iniciar apresentação/ })).toHaveCount(0); // avaliador só assiste
  await expect(telao.locator('.timer-status')).toHaveText('Em execução', { timeout: 20_000 });
  await expect(telao.getByRole('timer', { name: /Tempo total restante/ })).toBeVisible();
  await expect(telao.getByText('Estudante Fictício A1')).toHaveCount(0); // nomes ocultos por padrão
  // Fichas abertas em tempo real, sem recarregar, com a rubrica correta de cada docente.
  await expect(bruno.getByLabel('Domínio técnico')).toBeVisible();
  await expect(carla.getByLabel('Clareza da apresentação')).toBeVisible();
  await expect(carla.getByLabel('Domínio técnico')).toHaveCount(0);
  // Cronograma recebe o check "Iniciado".
  await expect(ana.locator('.sched-item', { hasText: 'Grupo 01' }).getByText('Iniciado')).toBeVisible();

  // Recarregar o telão não reinicia o tempo.
  await telao.reload();
  await expect(telao.locator('.timer-code')).toHaveText('Grupo 01');
  await expect(telao.locator('.timer-status')).toHaveText('Em execução');

  // Etapas: Apresentação (10 min) → Demonstração (5) → Perguntas (5). Acelerado 60x.
  await expect(telao.locator('.clock-stage .clock-label')).toContainText('Demonstração', { timeout: 20_000 });
  await expect(telao.locator('.clock-stage .clock-label')).toContainText('Perguntas e considerações', { timeout: 20_000 });
  await expect(telao.getByText('TEMPO ENCERRADO').first()).toBeVisible({ timeout: 20_000 });
  // Estouro do tempo: o telão dispara o som de palmas.
  await expect.poll(() => telao.evaluate(() => (window as any).__bancaApplausePlays ?? 0)).toBeGreaterThanOrEqual(1);

  // Docentes avaliam (nota zero é válida), votam e enviam.
  await fillEvaluation(ana, { 'Domínio técnico': '8', 'Funcionamento da demonstração': '9', 'Organização do projeto': '7', 'Respostas às perguntas': '10' }, 'Indicar');
  await fillEvaluation(bruno, { 'Domínio técnico': '0', 'Funcionamento da demonstração': '5', 'Organização do projeto': '5', 'Respostas às perguntas': '5' }, 'Não indicar');
  await fillEvaluation(carla, { 'Clareza da apresentação': '10', 'Uso do tempo': '8', 'Material visual': '6' }, 'Indicar');

  // Primária confere e fecha.
  await ana.getByRole('button', { name: 'Conferir e fechar avaliação' }).first().click();
  const dialog = ana.getByRole('dialog');
  await expect(dialog.locator('.final-value')).toHaveText('68,33');
  await dialog.getByRole('button', { name: /Conferir e fechar avaliação/ }).click();
  await ana.getByRole('dialog', { name: 'Fechar a avaliação deste projeto?' }).getByRole('button', { name: 'Fechar avaliação' }).click();
  await expect(dialog.getByText(/Avaliação fechada/)).toBeVisible();

  // PDF fiel ao fechamento.
  const [download] = await Promise.all([ana.waitForEvent('download'), dialog.getByRole('link', { name: /Baixar PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/avaliacao-Grupo_01-v1\.pdf/);
  const path = await download.path();
  const fs = await import('node:fs');
  expect(fs.readFileSync(path!).subarray(0, 5).toString()).toBe('%PDF-');
  await ana.keyboard.press('Escape');

  // Avaliador não baixa o PDF nem pela URL.
  const forbidden = await bruno.request.get('/api/groups/1/report.pdf');
  expect(forbidden.status()).toBe(403);

  // Passa ao Grupo 02 sem perder o Grupo 01.
  // Troca: o telão sai do TEMPO ENCERRADO do Grupo 01 para "Aguardando" (o Grupo 02 ainda não foi aberto).
  await ana.locator('.sched-item', { hasText: 'Grupo 02' }).getByRole('button', { name: 'Selecionar' }).click();
  await expect(telao.getByRole('heading', { name: 'Aguardando' })).toBeVisible();
  await expect(telao.locator('.timer-code')).toHaveCount(0);
  await expect(ana.locator('.sched-item', { hasText: 'Grupo 01' }).getByText('Finalizado')).toBeVisible();
  await ana.getByRole('button', { name: /Iniciar apresentação/ }).click();
  await expect(telao.locator('.timer-code')).toHaveText('Grupo 02');
  await expect(bruno.getByLabel('Domínio técnico')).toHaveValue('');
  await expect(bruno.locator('.sched-item', { hasText: 'Grupo 01' }).getByText('Enviada')).toBeVisible();
});

test('acessibilidade: piscada substituída por alerta estático com movimento reduzido', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/cronometro');
  await expect(page.locator('.timer-code')).toHaveText('Grupo 02');
  // O Grupo 02 iniciou no teste anterior; com 60x, termina em ~20 s.
  await expect(page.getByText('TEMPO ENCERRADO').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.timer.over-static')).toHaveCount(1);
  await expect(page.locator('.timer.over-blink')).toHaveCount(0);
});
