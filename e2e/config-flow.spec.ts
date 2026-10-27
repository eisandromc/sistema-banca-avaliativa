import { expect, test, type Page } from '@playwright/test';

/**
 * Monta uma banca do zero apenas pela interface da Configuração, seguindo as etapas na ordem do menu
 * (cadastros base → banca → grupos → distribuição → primário e avaliadores), e a coloca em uso.
 */

async function login(page: Page, email: string, password = 'demo1234') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}

async function tab(page: Page, name: string) {
  await page.getByRole('tab', { name }).click();
}

test('administrador configura uma banca nova pela interface e o primário a conduz', async ({ page, browser }) => {
  await login(page, 'admin@demo.banca');
  await page.goto('/configuracao');

  // O menu segue a ordem de preenchimento.
  await expect(page.locator('.cfg-nav .tab-trigger').nth(8)).toBeVisible();
  const steps = await page.locator('.cfg-nav .tab-trigger').allInnerTexts();
  expect(steps.slice(1, 9).map((s) => s.replace(/\s+/g, ' ').trim())).toEqual([
    '1 Professores',
    '2 Perfis de tempo',
    '3 Tipos de rubrica',
    '4 Banca e dias',
    '5 Grupos',
    '6 Distribuição nos dias',
    '7 Primário e avaliadores',
    '8 Votação (opcional)',
  ]);

  // 1. Conta do docente que vai conduzir
  await tab(page, 'Professores');
  await page.getByRole('button', { name: '+ Nova conta' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox', { name: 'Nome', exact: true }).fill('Prof. Novo E2E (fictício)');
  await dlg.getByLabel('E-mail').fill('novo.e2e@demo.banca');
  await dlg.getByLabel('Senha inicial').fill('senha-e2e-123');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('cell', { name: 'novo.e2e@demo.banca' })).toBeVisible();

  // 2. Perfil de tempo 8 + 4 min
  await page.getByRole('button', { name: /Próxima etapa: 2\. Perfis de tempo/ }).click();
  await page.getByRole('button', { name: '+ Novo perfil' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox', { name: 'Nome', exact: true }).fill('Curto 8 + 4');
  await dlg.getByLabel('Minutos da etapa 1').fill('8');
  await dlg.getByLabel('Minutos da etapa 2').fill('4');
  // O perfil novo vem com 4 etapas (a 3ª é a pausa de preparação): ficam só as duas primeiras.
  await dlg.getByRole('button', { name: 'Remover etapa 4' }).click();
  await dlg.getByRole('button', { name: 'Remover etapa 3' }).click();
  await expect(dlg.getByText('Total: 12:00')).toBeVisible();
  await dlg.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('heading', { name: 'Curto 8 + 4' })).toBeVisible();

  // 3. Tipo de rubrica com duas rubricas dentro
  await tab(page, 'Tipos de rubrica');
  await page.getByRole('button', { name: '+ Novo tipo de rubrica' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nome do tipo').fill('Tipo E2E');
  await dlg.getByRole('button', { name: 'Salvar tipo' }).click();
  const tipo = page.locator('.type-card', { has: page.getByRole('heading', { name: /Tipo E2E/ }) });
  for (const [nome, criterio] of [
    ['Rubrica E2E Técnica', 'Qualidade técnica'],
    ['Rubrica E2E Apresentação', 'Clareza'],
  ]) {
    await tipo.getByRole('button', { name: '+ Nova rubrica em “Tipo E2E”' }).click();
    dlg = page.getByRole('dialog');
    await dlg.getByLabel('Nome da rubrica').fill(nome);
    await dlg.getByLabel('Título da versão').fill(`Avaliação — ${nome}`);
    await dlg.getByRole('textbox', { name: 'Título', exact: true }).fill(criterio);
    await dlg.getByRole('button', { name: 'Salvar' }).click();
    await expect(tipo.getByText(nome, { exact: true })).toBeVisible();
  }
  await expect(tipo.locator('.rubric-pos')).toHaveText(['1', '2']);

  // 4. Banca vinculada ao tipo, com um dia
  await tab(page, 'Banca e dias');
  await page.getByRole('button', { name: '+ Nova banca' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nome da banca').fill('Banca Config E2E (fictícia)');
  await dlg.getByLabel('Tipo de rubrica').selectOption({ label: 'Tipo E2E' });
  await dlg.getByLabel('Instituição', { exact: true }).fill('Escola Fictícia E2E');
  await dlg.getByRole('tab', { name: 'Regras da avaliação' }).click();
  await expect(dlg.getByLabel('Resultado da banca')).toBeVisible();
  await dlg.getByRole('button', { name: 'Salvar banca' }).click();
  await expect(page.getByRole('heading', { name: 'Banca Config E2E (fictícia)' })).toBeVisible();
  await expect(page.locator('.facts')).toContainText('Tipo E2E');
  await page.getByRole('button', { name: '+ Novo dia' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Identificação').fill('Dia E2E');
  await dlg.getByLabel('Data').fill('2026-12-01');
  await dlg.getByLabel('Perfil de tempo padrão').selectOption({ label: 'Curto 8 + 4' });
  await dlg.getByRole('button', { name: 'Salvar dia' }).click();
  await expect(page.locator('.day-item', { hasText: 'Dia E2E' })).toContainText('Intervalo 10:00–10:20');

  // 5. Dois grupos com resumo, orientadores, materiais e cor gerada
  await tab(page, 'Grupos');
  for (const [code, title] of [
    ['E2E-1', 'Projeto Configurado pela Interface'],
    ['E2E-2', 'Segundo Projeto da Interface'],
  ]) {
    await page.getByRole('button', { name: '+ Novo grupo' }).click();
    dlg = page.getByRole('dialog');
    await dlg.getByLabel('Número/código').fill(code);
    await dlg.getByLabel('Turma').fill('9º Z');
    await dlg.getByLabel('Título do projeto').fill(title);
    await dlg.getByLabel('Resumo do projeto').fill(`Resumo fictício do ${code}.`);
    await dlg.getByLabel('Alunos (um por linha)').fill('Estudante Fictício X\nEstudante Fictícia Y');
    await dlg.getByRole('textbox', { name: 'Orientador 1' }).fill('Profa. Orientadora E2E');
    await dlg.getByRole('button', { name: '+ Orientador' }).click();
    await dlg.getByRole('textbox', { name: 'Orientador 2' }).fill('Prof. Coorientador E2E');
    await dlg.getByLabel('Apresentação (slides)').fill('/demo/apresentacao-exemplo.pdf');
    await dlg.getByLabel('PDF (artigo ou relatório)').fill('/demo/artigo-exemplo.pdf');
    // A cor vem gerada (uma cor da paleta já marcada).
    await expect(dlg.getByRole('radio', { checked: true })).toHaveCount(1);
    await dlg.getByRole('button', { name: 'Salvar grupo' }).click();
    await expect(page.locator('.group-card', { hasText: code })).toBeVisible();
  }
  const card1 = page.locator('.group-card', { hasText: 'E2E-1' });
  await expect(card1.getByText('sem dia')).toBeVisible();
  await expect(card1.getByText('Apresentação')).toBeVisible();
  const colors = await page.locator('.group-card').evaluateAll((els) => els.map((e) => getComputedStyle(e).borderTopColor));
  expect(new Set(colors).size).toBe(2); // cada grupo com sua cor

  // 6. Distribuição: E2E-1 pelo seletor "Mover para"; E2E-2 arrastando para o dia, acima do E2E-1
  await tab(page, 'Distribuição nos dias');
  const semDia = page.locator('.board-col.is-unplaced');
  await page.getByLabel('Mover E2E-1 para').selectOption({ label: 'Dia E2E · 01/12/2026' });
  const diaCol = page.locator('.board-col', { hasText: 'Dia E2E · 01/12/2026' });
  await expect(diaCol.locator('.board-card', { hasText: 'E2E-1' })).toContainText('Previsto 07:30');
  const handle = semDia.getByRole('button', { name: /Arrastar E2E-2/ });
  const target = diaCol.locator('.board-card', { hasText: 'E2E-1' });
  const hb = (await handle.boundingBox())!;
  const tb = (await target.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 30, hb.y + 30, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 8, { steps: 15 });
  await page.mouse.up();
  await expect(diaCol.locator('.board-card')).toHaveCount(2);
  await expect(diaCol.locator('.board-card').first()).toContainText('E2E-2');
  await expect(diaCol.locator('.board-card', { hasText: 'E2E-1' }).locator('.order-badge')).toContainText('#2');
  await expect(diaCol.locator('.board-card', { hasText: 'E2E-1' })).toContainText('Previsto 07:47'); // 12 min + 5 de troca
  // A ordem também pode ser trocada pelas setas.
  await page.getByRole('button', { name: 'Subir E2E-1' }).click();
  await expect(diaCol.locator('.board-card').first()).toContainText('E2E-1');

  // 7. Primário e avaliadores do dia: só a ficha do tipo de rubrica da banca
  await tab(page, 'Primário e avaliadores');
  await expect(page.getByText('Nenhum primário designado')).toBeVisible();
  await page.getByRole('button', { name: 'Designar primário' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Docente').selectOption({ label: 'Prof. Novo E2E (fictício)' });
  await dlg.getByLabel('Ficha que ele vai preencher').selectOption({ label: '1ª ficha — Avaliação — Rubrica E2E Técnica' });
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Professor primário designado')).toBeVisible();
  await expect(page.locator('.step-card', { hasText: 'Professor primário' })).toContainText('Também preenche a 1ª ficha — Avaliação — Rubrica E2E Técnica');
  await expect(page.getByRole('row', { name: /Prof\. Novo E2E/ })).toContainText('primário');
  await page.getByLabel('Docente', { exact: true }).selectOption({ label: 'Prof. Bruno Modelo (Demo)' });
  await page.getByLabel('Ficha', { exact: true }).selectOption({ label: '2ª ficha — Avaliação — Rubrica E2E Apresentação' });
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('row', { name: /Prof\. Bruno Modelo/ })).toBeVisible();

  // 8. Votação
  await page.getByRole('button', { name: /Próxima etapa: 8\. Votação/ }).click();
  await page.getByRole('button', { name: '+ Nova pergunta' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Título da decisão').fill('Aprovação');
  await dlg.getByRole('textbox', { name: 'Pergunta', exact: true }).fill('O projeto está aprovado?');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('heading', { name: /Aprovação/ })).toBeVisible();

  // Roteiro de preparação: tudo pronto para a banca nova.
  await tab(page, 'Visão geral');
  await expect(page.getByText('✓ Banca pronta para começar')).toBeVisible();

  // O avaliador (Bruno) entra antes do primário: aguarda com a lista do dia em ordem e lê o projeto.
  const bctx = await browser.newContext();
  const bruno = await bctx.newPage();
  await login(bruno, 'bruno@demo.banca');
  await bruno.goto('/professor');
  await bruno.getByRole('button', { name: /Banca Config E2E \(fictícia\) · Dia E2E/ }).click();
  await expect(bruno.getByRole('heading', { name: 'Aguardando o professor primário' })).toBeVisible();
  await expect(bruno.locator('.order-row').first()).toContainText('E2E-1');
  await expect(bruno.locator('.order-row').first()).toContainText('07:30');
  await expect(bruno.locator('.order-row').nth(1)).toContainText('07:47');
  await bruno.getByRole('button', { name: 'Projeto de E2E-1' }).click();
  const proj = bruno.getByRole('dialog');
  await expect(proj.getByText('Resumo fictício do E2E-1.')).toBeVisible();
  await expect(proj.getByText('Profa. Orientadora E2E e Prof. Coorientador E2E')).toBeVisible();
  await expect(proj.getByRole('link', { name: 'Baixar PDF' })).toHaveAttribute('href', '/demo/artigo-exemplo.pdf');
  await proj.getByRole('button', { name: 'Ver apresentação' }).click();
  await expect(bruno.locator('iframe.viewer-frame')).toHaveAttribute('src', '/demo/apresentacao-exemplo.pdf#view=Fit');
  await bruno.getByRole('button', { name: 'Voltar ao projeto' }).click();
  await bruno.keyboard.press('Escape');

  // O docente novo conduz a banca recém-criada
  const ctx = await browser.newContext();
  const prof = await ctx.newPage();
  await login(prof, 'novo.e2e@demo.banca', 'senha-e2e-123');
  await prof.goto('/professor'); // único dia do docente: abre direto
  await expect(prof.getByText('Você é o(a) professor(a) primário(a)')).toBeVisible();
  await prof.locator('.sched-item', { hasText: 'E2E-1' }).getByRole('button', { name: 'Selecionar' }).click();
  await expect(prof.locator('.current-group')).toContainText('Orientadores: Profa. Orientadora E2E e Prof. Coorientador E2E');
  await expect(prof.getByRole('timer', { name: /Tempo total restante 12:00/ })).toBeVisible();
  // O avaliador vê quem é o próximo, ainda aguardando.
  await expect(bruno.getByText('Próximo a se apresentar:')).toBeVisible();
  await prof.getByRole('button', { name: /Iniciar apresentação/ }).click();
  await expect(prof.getByLabel('Qualidade técnica')).toBeVisible();
  await expect(prof.getByText('O projeto está aprovado?')).toBeVisible();
  // A ficha do avaliador abre sozinha, com a 2ª rubrica do tipo.
  await expect(bruno.getByLabel('Clareza')).toBeVisible();
  await prof.getByRole('button', { name: /Pausar/ }).click();
  await expect(prof.locator('.timer-status')).toHaveText('Pausado');
  await ctx.close();
  await bctx.close();

  // Auditoria registra as ações
  await tab(page, 'Auditoria');
  await expect(page.getByText('day.primary_changed').first()).toBeVisible();
  await expect(page.getByText('rubric_type.created').first()).toBeVisible();
  await expect(page.getByText('timer.started').first()).toBeVisible();
});
