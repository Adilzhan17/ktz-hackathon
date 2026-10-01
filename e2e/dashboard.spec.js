import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/api/action', { data: { type: 'reset' } });
});

test('overview shows KPIs, the Gantt chart and the attention card', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Оперативная обстановка' })).toBeVisible();
  await expect(page.getByText('Движение по графику').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /График движения: 30 поездов/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Требует решения' })).toBeVisible();
  await expect(page.getByText('Опозданий нет')).toBeVisible();
});

test('closure: conflicts, three variants, choosing and confirming a plan notifies passengers', async ({ page }) => {
  await page.goto('/#/decisions');
  await page.getByRole('button', { name: /Закрыть перегон D–E/ }).click();
  await expect(page.locator('.incident-line')).toContainText('Закрыт нечётный путь перегона D–E');
  const variants = page.getByRole('radiogroup', { name: 'Варианты пропуска поездов' }).locator('label.variant');
  await expect(variants).toHaveCount(3);
  await expect(variants.first()).toContainText('Рекомендуется');
  await variants.nth(2).click();
  await expect(variants.nth(2)).toHaveClass(/on/);
  await expect(page.locator('.notices li')).toHaveCount(0);       // до подтверждения пассажиров не тревожим
  await page.getByRole('button', { name: /Подтвердить вариант/ }).click();
  await expect(page.getByText('План подтверждён')).toBeVisible();
  await expect(page.locator('.notices li').first()).toContainText('опоздание');
  // на главной появилась карточка и бейдж в меню
  await page.getByRole('link', { name: 'Обстановка' }).click();
  await expect(page.getByText('План подтверждён:')).toBeVisible();
  await page.goto('/#/decisions');
  await page.getByRole('button', { name: 'Снять закрытие' }).click();
  await expect(page.getByText('Конфликтов нет')).toBeVisible();
});

test('attention badge appears in the menu while a closure awaits a decision', async ({ page }) => {
  await page.goto('/#/decisions');
  await page.getByRole('button', { name: /Закрыть перегон D–E/ }).click();
  await expect(page.locator('.nav-badge')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Перейти к решению' })).toBeVisible();
});

test('speed restriction is entered and lifted, delays appear in KPIs', async ({ page }) => {
  await page.goto('/#/decisions');
  await page.getByLabel('Перегон').selectOption('4');
  await page.getByLabel('Скорость, км/ч').selectOption('25');
  await page.getByRole('button', { name: 'Ввести', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Действующие ограничения' })).toBeVisible();
  await page.getByRole('link', { name: 'Обстановка' }).click();
  await expect(page.locator('.kpi', { hasText: 'Задержано поездов' })).not.toContainText('задержек нет');
  await page.goto('/#/decisions');
  await page.getByRole('button', { name: 'Снять', exact: true }).click();
  await page.getByRole('link', { name: 'Обстановка' }).click();
  await expect(page.locator('.kpi', { hasText: 'Задержано поездов' })).toContainText('задержек нет');
});

test('station lifecycle: complete, clear, reserve, time advance, admit', async ({ page }) => {
  await page.goto('/#/station/D');
  await expect(page.getByRole('heading', { name: 'Станция Казан' })).toBeVisible();
  const row = page.locator('tbody tr').first();
  await row.getByRole('button', { name: 'Завершить' }).click();
  await expect(row.getByRole('button', { name: /Убрать 10/ })).toBeVisible();
  await row.getByRole('button', { name: /Убрать 10/ }).click();
  await expect(row).toContainText('Обработки нет');
  await page.getByRole('button', { name: 'Зарезервировать приём' }).click();
  await expect(page.locator('.kpi', { hasText: 'В резерве' })).toContainText('10');
  await page.getByRole('tab', { name: /Подход вагонов/ }).click();
  await expect(page).toHaveURL(/#\/station\/D\/arrivals/);
  const accept = page.getByRole('button', { name: 'Принять' });
  await expect(accept).toHaveAttribute('aria-disabled', 'true'); // группа ещё в пути, причина объяснена
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '+1 час' }).click();
  await accept.click();
  await expect(page.locator('.badge', { hasText: 'Принята' })).toHaveCount(0); // принятые уходят из очереди
  await expect(page.locator('.toast').last()).toContainText('принято');
});

test('keyboard focus survives an action (no full re-render)', async ({ page }) => {
  await page.goto('/#/station/D');
  const btn = page.locator('tbody tr').first().getByRole('button', { name: 'Завершить' });
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('tbody tr').first().getByRole('button', { name: /Убрать 10/ })).toBeVisible();
  await expect(btn).toBeFocused();
});

test('trains page: filter, sort, show on Gantt', async ({ page }) => {
  await page.goto('/#/trains');
  await expect(page.locator('tbody tr')).toHaveCount(30);
  await page.getByRole('radio', { name: 'Пассажирские' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await page.getByRole('searchbox').fill('153');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'На ГИД' }).click();
  await expect(page).toHaveURL(/#\/$|\/$/);
  await expect(page.locator('.selection')).toContainText('№153');
});

test('station list, deep link and unknown station', async ({ page }) => {
  await page.goto('/#/stations');
  await page.getByRole('link', { name: /Майтак/ }).click();
  await expect(page).toHaveURL(/#\/station\/E/);
  await page.goto('/#/station/ZZ');
  await expect(page.getByText('Такой станции нет')).toBeVisible();
});

test('API rejects invalid operations without altering state', async ({ request }) => {
  const before = await (await request.get('/api/state')).json();
  for (const bad of [{ type: 'complete', trackId: 'X' }, { type: 'restrict', segment: 99, kmh: 25 }, { type: 'advance', minutes: 7 }, { type: 'nope' }]) {
    const res = await request.post('/api/action', { data: bad });
    expect(res.status()).toBe(400);
  }
  const after = await (await request.get('/api/state')).json();
  expect(after.revision).toBe(before.revision);
  expect((await request.get('/../server/model.js')).status()).toBe(404);
});

test('two tabs stay in sync', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto('/'); await b.goto('/');
  await a.getByRole('button', { name: '+15 мин' }).click();
  await expect(b.locator('.clock strong')).toHaveText('09:15');
});

test('phone layout: no horizontal overflow, bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/#/decisions', '/#/trains', '/#/station/D', '/#/log', '/#/how']) {
    await page.goto(path);
    await page.waitForSelector('main h1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  const nav = await page.locator('.nav').boundingBox();
  expect(nav.y).toBeGreaterThan(700);
});

test('how-it-works page: animated demos, stepper, cases, sandbox does not touch the shared shift', async ({ page, request }) => {
  await page.goto('/#/how');
  await expect(page.getByRole('heading', { name: 'Как это работает', level: 1 })).toBeVisible();
  // проблема: плеер переключает фазы
  const demo = page.locator('.problem');
  await expect(demo.locator('.demo-caption h3')).toHaveText('Всё идёт по графику');
  await demo.getByRole('button', { name: 'Следующий шаг' }).click();
  await expect(demo.locator('.demo-caption h3')).toHaveText('Сход на перегоне');
  // факторы
  await expect(page.locator('.factor')).toHaveCount(6);
  // алгоритм: реальный движок в браузере
  const stepper = page.locator('.stepper');
  await stepper.locator('.steps').getByRole('button', { name: /Находим конфликты/ }).click();
  await expect(stepper.locator('.stage-text')).toContainText('конфликт');
  await expect(stepper.locator('svg.lanes')).toBeVisible();
  await stepper.locator('.steps').getByRole('button', { name: /Строим варианты/ }).click();
  await expect(stepper.locator('.mini-variants figure')).toHaveCount(3);
  await stepper.locator('.steps').getByRole('button', { name: /Пассажиры узнают/ }).click();
  await expect(stepper.locator('.push').first()).toContainText('Поезд');
  // случаи
  await page.getByRole('tab', { name: 'Окно и ограничение скорости' }).click();
  await expect(page.locator('.flow')).toContainText('25 км/ч');
  // песочница
  const sb = page.locator('.sandbox');
  await sb.getByRole('button', { name: /Закрыть перегон D–E/ }).click();
  await expect(sb.locator('.sandbox-kpis span').first()).not.toHaveText(/^0 /);
  await sb.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(sb.locator('.sandbox-kpis')).toContainText('уведомлений пассажирам');
  expect((await (await request.get('/api/state')).json()).blocked).toBe(false);
});

test('icons morph: sort chevron changes its path when direction flips', async ({ page }) => {
  await page.goto('/#/trains');
  const th = page.getByRole('columnheader', { name: /Опоздание/ });
  const d = () => th.locator('svg path').getAttribute('d');
  const before = await d();
  await th.getByRole('button').click();
  await page.waitForTimeout(900);
  expect(await d()).not.toBe(before);
});

test('quick search navigates without changing the shared shift and restores focus', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Поиск поездов и станций' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Найти поезд или станцию' });
  const input = dialog.getByRole('searchbox');
  await expect(input).toBeFocused();
  await input.fill('153');
  await dialog.getByRole('button', { name: /№153/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.selection')).toContainText('№153');
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await input.fill('Казан');
  await dialog.getByRole('region', { name: 'Найденные станции' }).getByRole('button', { name: /Казан/ }).click();
  await expect(page).toHaveURL(/#\/station\/D/);
  await expect(page.getByRole('heading', { name: 'Станция Казан' })).toBeVisible();
  await trigger.click();
  await input.fill('несуществующий объект');
  await expect(dialog.getByRole('status')).toContainText('Ничего не найдено');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect((await (await request.get('/api/state')).json()).revision).toBe(before.revision);
});

test('corridor opens a station and mobile overflow menu preserves secondary routes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.corridor-stops li')).toHaveCount(10);
  await page.getByRole('link', { name: 'Открыть станцию Майтак' }).click();
  await expect(page.getByRole('heading', { name: 'Станция Майтак' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-more summary').click();
  await page.locator('.more-links').getByRole('link', { name: 'Журнал', exact: true }).click();
  await expect(page).toHaveURL(/#\/log/);
  await expect(page.locator('.mobile-more')).not.toHaveAttribute('open', '');
  await page.locator('.mobile-more summary').click();
  await page.locator('.more-links').getByRole('link', { name: 'Как это работает' }).click();
  await expect(page).toHaveURL(/#\/how/);
  await page.locator('.mobile-more summary').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.more-links')).not.toBeVisible();
});

test('tablet and desktop layouts contain overflow within data regions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const width of [768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/#/trains', '/#/decisions', '/#/stations']) {
      await page.goto(path);
      await page.waitForSelector('main h1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.corridor')).toBeVisible();
  expect(errors).toEqual([]);
});
