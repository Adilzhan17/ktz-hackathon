import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { JournalPush, validateSubscription } from '../server/push.js';
const ec = createECDH('prime256v1'); ec.generateKeys();
const sub = { endpoint: 'https://web.push.apple.com/test', keys: { auth: randomBytes(16).toString('base64url'), p256dh: ec.getPublicKey().toString('base64url') } };
test('push rejects arbitrary destinations and invalid subscription keys', () => {
  assert.throws(() => validateSubscription({ ...sub, endpoint: 'https://127.0.0.1/admin' }));
  assert.throws(() => validateSubscription({ ...sub, endpoint: 'https://web.push.apple.com.attacker.test/a' }));
  assert.throws(() => validateSubscription({ ...sub, keys: {} }));
  assert.equal(validateSubscription(sub).endpoint, sub.endpoint);
});
test('opt-in receives each new event individually, removing subscription stops sends', async () => {
  const sent = [], push = new JournalPush(null, { send: async (s, payload) => sent.push(JSON.parse(payload)) });
  push.enqueue([{ id: 'before', text: 'до подписки' }]); push.add(sub);
  push.enqueue([{ id: 'a', number: 1, text: 'a' }, { id: 'b', number: 2, text: 'b' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.map(e => e.id), ['a', 'b']);
  push.remove(sub); push.enqueue([{ id: 'c', text: 'c' }]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sent.length, 2);
});
