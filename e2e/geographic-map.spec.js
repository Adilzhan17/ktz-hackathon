import { test, expect } from '@playwright/test';
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page, request }) => {
  await request.post('/api/action', { data: { type: 'reset' } });
  await page.route(/https:\/\/(tile.openstreetmap.org|tiles.openrailwaymap.org)\//, route => route.fulfill({ contentType: 'image/png', body: tile }));
});

test('map selection, train movement and layer controls share the dispatcher state', async ({ page, request }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/map');
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  const before = await (await request.get('/api/state')).json();
  await page.getByRole('button', { name: 'Выбрать станцию Дария', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.geo-details h2')).toHaveText('Дария');
  await expect(page.locator('.dispatcher .tc-head')).toContainText('Дария');
  await expect(page.getByRole('link', { name: 'Грузовая работа станции' })).toHaveAttribute('href', '#/station/D');
  const now = (before.now - before.baseTime) / 60000;
  const train = before.trains.find(t => t.forecast[0][0] < now && t.forecast.at(-1)[0] > now + 30 && !t.service);
  await page.getByLabel('Выбрать поезд на карте').selectOption(train.number);
  await expect(page.locator('.geo-details h2')).toHaveText(`Поезд №${train.number}`);
  await expect(page.locator('.dispatcher .tc-head')).toContainText(train.number);
  const marker = page.getByRole('button', { name: `Выбрать поезд №${train.number}`, exact: true });
  const transform = await marker.getAttribute('style');
  await request.post('/api/action', { data: { type: 'advance', minutes: 15 } });
  await expect.poll(() => marker.getAttribute('style')).not.toBe(transform);
  await page.getByLabel('Слой OpenRailwayMap').uncheck();
  await expect(page.locator('.geo-map .leaflet-tile-container')).toHaveCount(1);
  await page.getByLabel('Слой OpenRailwayMap').check();
  await expect(page.locator('.geo-map .leaflet-tile-container')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('map keeps stations and moving trains when external tiles fail, on a phone', async ({ page }) => {
  await page.unroute(/https:\/\/(tile.openstreetmap.org|tiles.openrailwaymap.org)\//);
  await page.route(/https:\/\/(tile.openstreetmap.org|tiles.openrailwaymap.org)\//, route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/map');
  await expect(page.getByRole('status').filter({ hasText: 'Фоновая карта недоступна' })).toBeVisible();
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  await expect(page.locator('.geo-train-icon').first()).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.locator('.mobile-more summary').click();
  await expect(page.locator('.more-links').getByRole('link', { name: 'Карта', exact: true })).toBeVisible();
  await page.goto('/#/stations');
  await page.goto('/#/map');
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
});

test('map highlights closures and speed restrictions on the selected corridor', async ({ page, request }) => {
  await page.goto('/#/map');
  await expect(page.locator('.geo-station-icon')).toHaveCount(10);
  await request.post('/api/action', { data: { type: 'restrict', segment: 5, kmh: 25 } });
  await expect(page.locator('.geo-map path[stroke="#a96b06"]')).toHaveCount(1);
  await request.post('/api/action', { data: { type: 'close', segment: 3, track: 'odd', reason: 'derailment' } });
  await expect(page.locator('.geo-map path[stroke="#bf2520"]')).toHaveCount(1);
});
