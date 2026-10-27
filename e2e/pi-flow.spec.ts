import { expect, test, type Browser, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

/**
 * Banca do Projeto Integrador (seed fictício): 4 professores avaliam com a escala 0–5 por botões de nível,
 * escrevem a devolutiva; a primária registra o parecer da banca, fecha e baixa o PDF no formato do instrumento.
 */

const PI_DAY1 = /Banca do Projeto Integrador — DEMONSTRAÇÃO · Dia 1/;

async function openPiDay1(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login?voltar=/professor');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await page.waitForURL('**/professor');
  await page.getByRole('button', { name: PI_DAY1 }).click();
  await expect(page.getByRole('heading', { name: 'Área do professor' })).toBeVisible();
  return page;
}

async function evaluate(page: Page, scores: number[], devolutivaLabel: string, devolutiva: string) {
  const criteria = page.locator('.criterion');
  await expect(criteria).toHaveCount(5);
  for (let i = 0; i < scores.length; i++) {
    await criteria
      .nth(i)
      .locator('.scale-opt', { has: page.locator('.scale-value', { hasText: new RegExp(`^${scores[i]}$`) }) })
      .click();
  }
  await page.getByLabel(devolutivaLabel).fill(devolutiva);
  await expect(page.getByText('Pronta para envio')).toBeVisible();
  await expect(page.getByText('Rascunho salvo no servidor')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar avaliação' }).click();
  await page.getByRole('button', { name: 'Confirmar envio' }).click();
  await expect(page.getByText('Ficha enviada').first()).toBeVisible();
}

function pdfText(buf: Buffer): string {
  const src = buf.toString('latin1');
  const out: string[] = [];
  for (const m of src.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content = m[1]!;
    try {
      content = inflateSync(Buffer.from(content, 'latin1')).toString('latin1');
    } catch {
      /* não comprimido */
    }
    for (const t of content.matchAll(/\[(.*?)\]\s*TJ/g)) {
      out.push([...t[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join(''));
    }
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

test('banca do Projeto Integrador: escala 0–5, soma /100, parecer e PDF preenchido', async ({ browser }) => {
  const ana = await openPiDay1(browser, 'ana@demo.banca');
  const bruno = await openPiDay1(browser, 'bruno@demo.banca');
  const carla = await openPiDay1(browser, 'carla@demo.banca');
  const daniel = await openPiDay1(browser, 'daniel@demo.banca');

  await ana.locator('.sched-item', { hasText: 'PI-01' }).getByRole('button', { name: 'Selecionar' }).click();
  await ana.getByRole('button', { name: /Iniciar apresentação/ }).click();

  // Cada professor recebe a rubrica da sua dimensão (a primária também avalia).
  await expect(ana.getByText('Avaliador - Conteúdo Técnico')).toBeVisible();
  await expect(bruno.getByText('Avaliador - Artigo e Pesquisa')).toBeVisible();
  await expect(carla.getByText('Avaliador - Projeto Integrador')).toBeVisible();
  await expect(daniel.getByText('Avaliador - Apresentação e Defesa')).toBeVisible();
  await expect(ana.locator('.scale-opt').first()).toContainText('Não evidenciado');

  await evaluate(ana, [5, 4, 4, 5, 4], 'Devolutiva técnica', 'Solução atende ao problema; ampliar testes.');
  await evaluate(bruno, [4, 4, 3, 4, 4], 'Devolutiva sobre o artigo e a pesquisa', 'Ampliar a fundamentação teórica.');
  await evaluate(carla, [3, 4, 4, 3, 4], 'Devolutiva sobre o desenvolvimento do Projeto Integrador', 'Relacionar melhor aos ODS.');
  await evaluate(daniel, [5, 4, 4, 4, 5], 'Devolutiva sobre a apresentação e a defesa', 'Distribuir melhor as falas.');
  await expect(ana.getByText('Subtotal: 22 / 25')).toBeVisible();

  // O fechamento só é permitido com a apresentação encerrada (aqui, pelo fim do tempo; cronômetro 60x).
  await expect(ana.getByText('TEMPO ENCERRADO').first()).toBeVisible({ timeout: 40_000 });

  // Conferência: total pela soma, parecer obrigatório.
  await ana.getByRole('button', { name: 'Conferir e fechar avaliação' }).first().click();
  const dlg = ana.getByRole('dialog');
  await expect(dlg.locator('.final-value')).toHaveText('81');
  await expect(dlg.getByText('de 100 · soma dos subtotais')).toBeVisible();
  await expect(dlg.getByText('Registre o parecer da banca.')).toBeVisible();
  await dlg.getByRole('radio', { name: 'Projeto desenvolvido', exact: true }).check();
  await dlg.getByLabel('Pontos fortes do grupo').fill('Domínio técnico e boa demonstração.');
  await dlg.getByLabel('Prioridades de melhoria').fill('Aprofundar a fundamentação.');
  await dlg.getByLabel('Orientações finais da banca').fill('Publicar o repositório documentado.');
  await dlg.getByRole('button', { name: 'Salvar parecer' }).click();
  await expect(ana.getByText('Parecer salvo.')).toBeVisible();
  await dlg.getByRole('button', { name: /Conferir e fechar avaliação/ }).click();
  await ana.getByRole('dialog', { name: 'Fechar a avaliação deste projeto?' }).getByRole('button', { name: 'Fechar avaliação' }).click();
  await expect(dlg.getByText(/Avaliação fechada/)).toBeVisible();

  const [download] = await Promise.all([ana.waitForEvent('download'), dlg.getByRole('link', { name: /Baixar PDF/ }).click()]);
  const text = pdfText(readFileSync((await download.path())!));
  for (const t of ['Rubrica de Avaliação da Banca do Projeto Integrador', 'Avaliador - Conteúdo Técnico', 'Subtotal do avaliador: 22 / 25', 'Registro Consolidado da Banca', 'TOTAL DA BANCA', '81 / 100', '( X ) Projeto desenvolvido', 'Sala 201']) {
    expect(text, t).toContain(t);
  }
});
