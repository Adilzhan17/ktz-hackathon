import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createState, snapshot, act } from './model.js';

let state = createState();
const clients = new Set();
const publicRoot = new URL('../public/', import.meta.url);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function broadcast() {
  const message = `data: ${JSON.stringify(snapshot(state))}\n\n`;
  for (const res of clients) res.write(message);
}
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
      if (action?.type === 'reset') state = createState();
      else act(state, action);
      broadcast(); return json(res, 200, snapshot(state));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Метод API не найден' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Метод не поддерживается' });
    const allowed = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
    const file = allowed[url.pathname];
    if (!file) return json(res, 404, { error: 'Страница не найдена' });
    const ext = file.slice(file.lastIndexOf('.'));
    const content = await readFile(fileURLToPath(new URL(file, publicRoot)));
    res.writeHead(200, { 'Content-Type': `${mime[ext]}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch (error) {
    json(res, 400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error.message });
  }
});
const heartbeat = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 1000);
server.listen(port, host, () => console.log(`Автодиспетчер: http://${host}:${port}`));
server.on('error', error => { console.error(error.message); clearInterval(heartbeat); process.exit(1); });
process.on('SIGTERM', () => { clearInterval(heartbeat); for (const client of clients) client.end(); server.close(); });
