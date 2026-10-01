import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/api/action', { data: { type: 'reset' } });
});

test('station cargo lifecycle, reservations, closure, CSV and live update', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Оперативная обстановка' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Станция Казан' })).toBeVisible();
  await expect(page.locator('.tracks-table tbody tr')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });

  const firstTrack = page.locator('.tracks-table tbody tr').first();
  await expect(firstTrack.locator('.done-count')).toHaveText('8');
  await firstTrack.getByRole('button', { name: 'Завершить' }).click();
  await expect(firstTrack.locator('.done-count')).toHaveText('10');
  await expect(firstTrack.locator('.pill')).toHaveText('0 ваг.');
  await firstTrack.getByRole('button', { name: 'Убрать 10' }).click();
  await expect(firstTrack.locator('.pill')).toHaveText('10 ваг.');

  await page.getByRole('tab', { name: /Подход вагонов/ }).click();
  const grain = page.locator('.groups-table tbody tr').filter({ hasText: 'Майтак' });
  await grain.getByRole('button', { name: 'В план' }).click();
  await expect(grain.locator('.pill.blue')).toHaveText('Резерв');
  await expect(grain.getByRole('button', { name: 'Принять' })).toBeDisabled();
  await grain.getByRole('button', { name: 'Отменить' }).click();
  await expect(grain.getByRole('button', { name: 'В план' })).toBeEnabled();

  const secondPage = await context.newPage();
  await secondPage.goto('/');
  await page.getByRole('button', { name: 'Сценарий: закрытие D–E' }).click();
  await expect(secondPage.getByRole('button', { name: 'Снять закрытие D–E' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Пассажирский — первым' })).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить вариант' }).click();
  await expect(page.locator('.graph-caption')).toContainText('учебный вариант подтверждён');
  await page.getByRole('button', { name: 'Снять закрытие D–E' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Выгрузить CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^autodispatch-D-\d+\.csv$/);
  expect(await download.failure()).toBeNull();
  expect(errors).toEqual([]);
  await secondPage.close();
});

test('station selection, search, filters, reset and phone layout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть станцию Кокшетау-2' }).click();
  await expect(page.getByRole('heading', { name: 'Станция Кокшетау-2' })).toBeVisible();
  await expect(page.locator('.tracks-table tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  await page.locator('.map-station[data-station="D"]').click();
  await expect(page.getByRole('heading', { name: 'Станция Казан' })).toBeVisible();
  await page.getByRole('searchbox').fill('нефтебаза');
  await expect(page.locator('.tracks-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.tracks-table tbody tr')).toContainText('Нефтебаза');
  await page.getByRole('searchbox').fill('несуществующий путь');
  await expect(page.locator('.empty')).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByLabel('Фильтр', { exact: true }).selectOption('ready');
  await expect(page.locator('.tracks-table tbody tr')).toHaveCount(9);

  await page.getByRole('button', { name: 'Сбросить демо' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'График', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оперативная обстановка' })).toBeVisible();
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('API rejects invalid operations without altering inventory', async ({ request }) => {
  const initial = await (await request.get('/api/state')).json();
  const invalid = await request.post('/api/action', { data: { type: 'reserve', groupId: 'D-G5' } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toContain('Недостаточно');
  const after = await (await request.get('/api/state')).json();
  expect(after.revision).toBe(initial.revision);
  expect(after.stations).toEqual(initial.stations);
  expect((await request.get('/missing')).status()).toBe(404);
});
