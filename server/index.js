import { refreshStationGeography } from './world.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { createState, snapshot, act, tick, advanceTime } from './model.js';

// KTZ_AUTOPLAY=0 — детерминированный режим для тестов: время стоит, события выключены, состояние не сохраняется.
// Иначе модель живёт в реальном времени: расписание строится непрерывно, события случаются сами, состояние хранится на диске.
const autoplay = process.env.KTZ_AUTOPLAY !== '0';
const STATE_FILE = process.env.KTZ_STATE || fileURLToPath(new URL('../data/state.json', import.meta.url));
const fresh = () => (autoplay
  ? Object.assign(createState({ now: Math.floor(Date.now() / 1000) * 1000, auto: { stations: true, intensity: 'normal', approve: true } }), { running: true, synced: true, speed: 1 })
  : createState());

function load() {
  if (!autoplay || !existsSync(STATE_FILE)) return fresh();
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (saved.version !== 2) return fresh();
    saved.planRev = (saved.planRev || 0) + 1;
    delete saved.version;
    refreshStationGeography(saved);
    // Пока сервер не работал, жизнь шла: догоняем реальное время (не больше суток).
    const gap = (Date.now() - saved.now) / 60_000;
    if (gap > 0) {
      advanceTime(saved, Math.min(gap, 24 * 60));
      if (gap > 24 * 60) saved.now = Date.now();
    }
    saved.speed = 1; saved.synced = saved.now >= Date.now() - 120_000 ? saved.synced : false;
    return saved;
  } catch (error) {
    console.error('Не удалось загрузить состояние, начинаем заново:', error.message);
    return fresh();
  }
}
function save() {
  if (!autoplay) return;
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify({ ...state, version: 2 }));
    renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (error) { console.error('Не удалось сохранить состояние:', error.message); }
}
let state = load();
const clients = new Set();
const publicRoot = new URL('../public/', import.meta.url);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const publicDir = fileURLToPath(publicRoot);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
const longCache = new Set(['.woff2', '.png']);
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function broadcast() {
  const message = `data: ${JSON.stringify(snapshot(state))}\n\n`;
  for (const res of clients) res.write(message);
}
const clock = () => `event: clock\ndata: ${JSON.stringify({ now: state.now, running: state.running, speed: state.speed, synced: state.synced })}\n\n`;
// Ход времени: раз в секунду. Реальный ход (×1) идёт всегда; ускорение — только пока кто-то смотрит.
// Полный снимок — при изменении данных и раз в 5 секунд, состояние на диск — раз в 20 секунд.
let ticks = 0;
const timer = setInterval(() => {
  ticks += 1;
  if (state.speed > 1 && !clients.size) { state.speed = 1; state.synced = false; }
  let changed = false;
  try { changed = tick(state, 1, Date.now()); } catch (error) { console.error('Ошибка шага модели:', error); }
  if (clients.size) {
    if (changed || ticks % 5 === 0) broadcast();
    else for (const res of clients) res.write(clock());
  }
  if (ticks % 20 === 0) save();
}, 1000);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot(state));
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot(state))}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Недопустимый источник запроса' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) return json(res, 413, { error: 'Слишком большой запрос' });
      }
      const action = JSON.parse(body);
      if (action?.type === 'reset') { state = fresh(); save(); }
      else act(state, action);
      broadcast(); return json(res, 200, snapshot(state));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Метод API не найден' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Метод не поддерживается' });
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    // Движок расчёта открыт клиенту: страница «Как это работает» запускает его в песочнице.
    if (['/engine/model.js', '/engine/dispatch.js', '/engine/world.js', '/engine/rail-corridor.js'].includes(url.pathname)) {
      const body = await readFile(fileURLToPath(new URL(`./${path.basename(url.pathname)}`, import.meta.url)));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(body);
    }
    // Любой путь без расширения — клиентский маршрут (SPA), отдаём index.html.
    let rel = decodeURIComponent(url.pathname);
    if (!path.extname(rel)) rel = '/index.html';
    const file = path.resolve(publicDir, '.' + rel);
    if (!file.startsWith(publicDir)) return json(res, 404, { error: 'Страница не найдена' });
    const ext = path.extname(file);
    if (!mime[ext]) return json(res, 404, { error: 'Страница не найдена' });
    let content;
    try { content = await readFile(file); } catch { return json(res, 404, { error: 'Страница не найдена' }); }
    res.writeHead(200, {
      'Content-Type': `${mime[ext]}${ext === '.woff2' || ext === '.png' ? '' : '; charset=utf-8'}`,
      'Cache-Control': longCache.has(ext) ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch (error) {
    json(res, 400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error.message });
  }
});
const heartbeat = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 1000);
server.listen(port, host, () => console.log(`Автодиспетчер: http://${host}:${port}`));
server.on('error', error => { console.error(error.message); clearInterval(heartbeat); clearInterval(timer); process.exit(1); });
process.on('SIGTERM', () => { save(); clearInterval(heartbeat); clearInterval(timer); for (const client of clients) client.end(); server.close(); });
