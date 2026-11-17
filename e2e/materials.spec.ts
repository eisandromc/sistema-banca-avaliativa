import { expect, test, type Page } from '@playwright/test';

/** Sinalizador de materiais nos cards de grupo: ícones por item e dica explicando o que falta. */

async function login(page: Page, email: string, path: string) {
  await page.goto(`/login?voltar=${path}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('demo1234');
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}

test('cards de grupo mostram os materiais e a dica explica o que falta', async ({ page }) => {
  await login(page, 'admin@demo.banca', '/configuracao');
  await page.goto('/configuracao');
  await page.locator('.cfg-context select').first().selectOption({ label: 'Banca de Cenários de Teste — DEMONSTRAÇÃO' });
  await page.getByRole('tab', { name: 'Grupos' }).click();

  const card = page.locator('.group-card', { hasText: 'C-01' });
  const indicator = card.getByRole('button', { name: /Materiais de C-01/ });
  await expect(indicator).toBeVisible();
  await expect(indicator.locator('.mat-icon')).toHaveCount(7);

  // Passar o mouse abre a dica; ela lista cada item como cadastrado ou faltando.
  await indicator.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip.locator('li')).toHaveCount(7);
  await expect(tip.getByText('Repositório no GitHub')).toBeVisible();
  await expect(tip.getByText(/— (cadastrado|falta:)/).first()).toBeVisible();

  // Teclado: Esc fecha; foco reabre.
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await indicator.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test('o cronograma do professor também mostra o sinalizador', async ({ page }) => {
  await login(page, 'ana@demo.banca', '/professor');
  await page.getByRole('button', { name: /Banca de Cenários de Teste — DEMONSTRAÇÃO · Dia de cenários/ }).click();
  const item = page.locator('.sched-item', { hasText: 'C-01' });
  await expect(item.getByRole('button', { name: /Materiais de C-01/ })).toBeVisible();
});
