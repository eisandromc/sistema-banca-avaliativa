import { expect, test, type Page } from '@playwright/test';

/** Duplicar banca e dia pela interface da Configuração (etapa 4 — Banca e dias). */

async function login(page: Page, email: string, password = 'demo1234') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).last().click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}

test('administrador duplica um dia e uma banca (com grupos) pela interface', async ({ page }) => {
  await login(page, 'admin@demo.banca');
  await page.goto('/configuracao');
  await page.getByRole('tab', { name: 'Banca e dias' }).click();

  // Banca em edição: a de demonstração.
  await page.locator('.cfg-context select').first().selectOption({ label: 'Banca de Projetos — DEMONSTRAÇÃO' });
  const days = page.locator('.day-item');
  const before = await days.count();

  // Duplicar dia: pede a data do novo dia.
  await days.first().getByRole('button', { name: /^Duplicar/ }).click();
  let dlg = page.getByRole('dialog');
  await expect(dlg.getByText(/mesmos horários, intervalos, sala, perfil de tempo/)).toBeVisible();
  await dlg.getByLabel('Data do novo dia').fill('2030-01-15');
  await dlg.getByRole('button', { name: 'Duplicar dia' }).click();
  await expect(days).toHaveCount(before + 1);
  await expect(page.locator('.day-item', { hasText: '(cópia)' })).toBeVisible();

  // Duplicar banca, levando também os grupos.
  await page.getByRole('button', { name: 'Duplicar', exact: true }).first().click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Copiar também os grupos/).check();
  await dlg.getByRole('button', { name: 'Duplicar banca' }).click();
  await expect(page.getByRole('heading', { name: 'Banca de Projetos — DEMONSTRAÇÃO (cópia)' })).toBeVisible();
  // A cópia traz os dias (inclusive a cópia criada acima).
  await expect(page.locator('.day-item')).toHaveCount(before + 1);

  // Os grupos vieram: etapa 5.
  await page.getByRole('tab', { name: 'Grupos' }).click();
  await expect(page.getByText('Grupo 01').first()).toBeVisible();
});
