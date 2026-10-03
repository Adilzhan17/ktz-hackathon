import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function validateSubscription(sub) {
  const url = new URL(sub?.endpoint);
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed.some(host => url.hostname === host || (host === 'web.push.apple.com' && url.hostname.endsWith('.' + host)))) throw new Error('Недопустимый push-сервис');
  if (sub.endpoint.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(sub.keys?.p256dh || '') || !/^[A-Za-z0-9_-]+$/.test(sub.keys?.auth || '') || Buffer.from(sub.keys.p256dh, 'base64url').length !== 65 || Buffer.from(sub.keys.auth, 'base64url').length !== 16) throw new Error('Некорректные ключи подписки');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export class JournalPush {
  constructor(directory, { send = webpush.sendNotification.bind(webpush) } = {}) {
    this.file = directory ? path.join(directory, 'web-push-private.json') : null;
    this.data = this.file && existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
    this.send = send; this.queue = []; this.running = false; this.dropped = 0; this.failed = 0; this.delivered = 0;
    this.save();
  }
  save() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  add(raw) {
    const sub = validateSubscription(raw);
    const existing = this.data.subscriptions.find(s => s.endpoint === sub.endpoint);
    if (!existing && this.data.subscriptions.length >= 100) throw new Error('Лимит подписок исчерпан');
    if (existing) { existing.keys = sub.keys; } else this.data.subscriptions.push(sub);
    this.save();
  }
  remove(raw) {
    const sub = validateSubscription(raw);
    this.data.subscriptions = this.data.subscriptions.filter(s => s.endpoint !== sub.endpoint || s.keys.auth !== sub.keys.auth);
    this.save();
  }
  enqueue(events) {
    for (const event of events) for (const sub of this.data.subscriptions) {
      if (this.queue.length >= 10000) { this.dropped++; continue; }
      this.queue.push({ event, sub, attempts: 0 });
    }
    void this.flush();
  }
  async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 4);
        await Promise.all(batch.map(async item => {
          const { event, sub } = item;
          if (!this.data.subscriptions.some(s => s.endpoint === sub.endpoint)) return;
          try {
            await this.send(sub, JSON.stringify({ title: `КТЖ · ${event.number ? '№' + event.number : 'Модель'}`, body: event.text.slice(0, 650), id: event.id, at: event.at }), {
              vapidDetails: { subject: 'https://ktz.perricheno.com', ...this.data.vapid }, timeout: 8000, TTL: 3600,
              topic: createHash('sha256').update(event.id).digest('base64url').slice(0, 32),
            });
            this.delivered++;
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) { this.data.subscriptions = this.data.subscriptions.filter(s => s.endpoint !== sub.endpoint); this.save(); }
            else { this.failed++; /* Journal remains authoritative; do not retry-storm the push service. */ }
          }
        }));
      }
    } finally { this.running = false; }
  }
}
