import { expect, test } from '@playwright/test';

/** Tela inicial com os três acessos, telão minimalista e roteiro de preparação com a banca de cenários. */

test('tela inicial: três acessos diretos, sem menu de áreas', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Acessos' });
  await expect(nav.getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: 'Áreas principais' })).toHaveCount(0);

  // Professor sem login → vai direto ao login e, depois, à área.
  await nav.getByRole('link', { name: /Professor/ }).click();
  await expect(page).toHaveURL(/\/login\?voltar=%2Fprofessor/);
  await expect(page.getByText('Acesso à área Professor.')).toBeVisible();
  await page.getByLabel('E-mail').fill('bruno@demo.banca');
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page).toHaveURL(/\/professor/);
  await expect(page.getByRole('heading', { name: 'Área do professor' })).toBeVisible();

  // A marca volta à tela inicial; o cartão sugerido para professor é o "Professor".
  await page.getByRole('link', { name: /tela inicial/ }).click();
  await expect(page.locator('.home-card.is-suggested')).toContainText('Professor');

  // Configuração pede administrador.
  await page.getByRole('link', { name: /Configuração/ }).click();
  await expect(page.getByText('Somente administradores acessam a configuração.')).toBeVisible();
});

test('telão: segue sozinho o dia ativado pelo primário, sem seleção; barra some quando ociosa', async ({ page, browser }) => {
  // A primária (Ana) controla o telão pela API da própria sessão.
  const actx = await browser.newContext();
  const ana = await actx.newPage();
  await ana.goto('/login');
  await ana.getByLabel('E-mail').fill('ana@demo.banca');
  await ana.getByLabel('Senha').fill('demo1234');
  await ana.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(ana.getByRole('button', { name: 'Sair' })).toBeVisible();
  const days = (await (await ana.request.get('/api/me/days')).json()).days;
  const sc = days.find((d: any) => d.label === 'Dia de cenários');
  const display = (active: boolean) => ana.request.post(`/api/days/${sc.id}/display`, { data: { active }, headers: { 'x-banca-csrf': '1' } });

  await page.goto('/');
  await page.getByRole('link', { name: /Cronômetro/ }).click();
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.day-card')).toHaveCount(0); // nenhuma lista de dias/grupos

  // Ativou: o telão troca sozinho para o dia de cenários (C-07 pausado).
  expect((await display(true)).status()).toBe(200);
  await expect(page.locator('.timer-code')).toHaveText('C-07');
  await expect(page.locator('.timer-status')).toHaveText('Pausado');
  await expect(page.getByRole('timer', { name: /Tempo total restante/ })).toBeVisible();

  // Desativou: volta sozinho a "Aguardando".
  expect((await display(false)).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Aguardando' })).toBeVisible();
  await expect(page.locator('.timer-code')).toHaveCount(0);
  expect((await display(true)).status()).toBe(200);
  await expect(page.locator('.timer-code')).toHaveText('C-07');

  await page.mouse.move(10, 10);
  await expect(page.locator('.projection-page')).not.toHaveClass(/is-idle/);
  await expect(page.locator('.projection-page')).toHaveClass(/is-idle/, { timeout: 8000 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /Início/ })).toBeVisible();
  await actx.close();
});

test('configuração: roteiro de preparação aponta pendências e leva à seção certa', async ({ page }) => {
  await page.goto('/login?voltar=/configuracao');
  await page.getByLabel('E-mail').fill('admin@demo.banca');
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await page.locator('.cfg-context select').first().selectOption({ label: 'Banca de Cenários de Teste — DEMONSTRAÇÃO' });
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  await expect(page.getByText(/item\(ns\) pendente\(s\) antes de começar/)).toBeVisible();
  const incompleto = page.locator('section', { has: page.getByRole('heading', { name: /Dia 2 — preparação incompleta/ }) });
  await expect(incompleto.getByText('Grupos sem avaliador: C-10.')).toBeVisible();
  await incompleto.getByRole('button', { name: 'Resolver: Avaliadores' }).click();
  await expect(page.getByRole('tab', { name: 'Primário e avaliadores' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Primário e avaliadores', level: 2 })).toBeVisible();
});

test('celular (390 px): nenhuma seção da Configuração transborda a largura da tela', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/login?voltar=/configuracao');
  await page.getByLabel('E-mail').fill('admin@demo.banca');
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  for (const secao of [
    'visao',
    'professores',
    'perfis',
    'rubricas',
    'bancas',
    'grupos',
    'distribuicao',
    'cronograma', // endereço antigo: abre a Distribuição
    'avaliadores',
    'votacao',
    'acompanhamento',
    'fechamento',
    'relatorios',
    'auditoria',
  ]) {
    await page.goto(`/configuracao?secao=${secao}`);
    await expect(page.locator('.panel-head h2')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), secao).toBeLessThanOrEqual(390);
  }
  for (const path of ['/', '/cronometro', '/professor']) {
    await page.goto(path);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
  await ctx.close();
});

test('ficha: se o salvamento falhar, o envio é bloqueado (nada diferente do exibido é enviado)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login?voltar=/professor');
  await page.getByLabel('E-mail').fill('bruno@demo.banca');
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await page.getByRole('button', { name: /Banca de Cenários de Teste — DEMONSTRAÇÃO · Dia de cenários/ }).click();
  // C-07 (pausado) é o grupo atual; a ficha do Bruno (Artigo e Pesquisa, níveis de 0 a 5) já está aberta.
  const level = (criterion: number, value: number) =>
    page.locator('.criterion').nth(criterion).locator('.scale-opt', { has: page.locator('.scale-value', { hasText: new RegExp(`^${value}$`) }) });
  for (const [i, v] of [2, 3, 4, 3, 4].entries()) await level(i, v).click();
  await page.getByRole('radio', { name: 'Indicar', exact: true }).check();
  await expect(page.getByText('Rascunho salvo no servidor')).toBeVisible();

  // A partir daqui o servidor recusa os rascunhos; o professor muda a nota e tenta enviar.
  await page.route('**/api/evaluations/*/draft', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"falha simulada"}' }));
  let submitted = false;
  await page.route('**/api/evaluations/*/submit', (r) => {
    submitted = true;
    return r.continue();
  });
  await level(0, 5).click();
  await page.getByRole('button', { name: 'Enviar avaliação' }).click();
  await expect(page.getByText(/Não foi possível salvar as últimas alterações no servidor/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Confirmar envio da avaliação' })).toHaveCount(0);
  expect(submitted).toBe(false);
  // A edição continua na tela para nova tentativa.
  await expect(level(0, 5)).toHaveClass(/selected/);
  await ctx.close();
});
