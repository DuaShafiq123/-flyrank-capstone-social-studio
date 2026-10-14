'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { ROOT, makeCtx, scheduledCampaign } = require('./helpers');
const { publishSlot } = require('../src/services/publisher');
const { PublisherRegistry } = require('../src/adapters/registry');
const { SocialPublisher } = require('../src/adapters/SocialPublisher');
const { TelegramPublisher } = require('../src/adapters/TelegramPublisher');

test('PROBE 6: swapping telegram -> mock_x is configuration only', async () => {
  for (const adapter of ['mock_x', 'mock_linkedin']) {
    const ctx = makeCtx({ ADAPTERS: `x=mock_x,linkedin=mock_linkedin,telegram=${adapter}` });
    const [slot] = scheduledCampaign(ctx, ['telegram']);
    const r = await publishSlot(ctx, slot.id);
    assert.equal(r.outcome, 'published');
    assert.equal(r.publication.adapter, adapter);
    console.log(`    telegram variant published via ${adapter}: ${r.publication.external_url}`);
  }
});

test('business logic never imports a concrete adapter', () => {
  const dir = path.join(ROOT, 'src', 'services');
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(src, /require\(['"][^'"]*adapters\//, `${file} imports an adapter`);
    assert.doesNotMatch(src, /Telegram|Discord|MockX|MockLinkedIn/, `${file} names a concrete adapter`);
  }
});

test('every registered adapter implements the SocialPublisher interface', () => {
  const ctx = makeCtx();
  for (const name of PublisherRegistry.knownAdapters()) {
    const a = ctx.registry.get(name);
    assert.ok(a instanceof SocialPublisher, name);
    assert.equal(a.name, name);
    assert.equal(typeof a.publish, 'function');
    assert.equal(typeof a.reconcile, 'function');
  }
});

test('an unknown adapter name in ADAPTERS fails fast at startup', () => {
  assert.throws(() => makeCtx({ ADAPTERS: 'telegram=telegramm' }), /unknown adapter "telegramm"/);
});

test('TelegramPublisher calls sendMessage and builds the public message link', async () => {
  let received;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received = { url: req.url, body: JSON.parse(raw) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: -1001234567890, username: 'my_studio_channel' } } }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const tg = new TelegramPublisher({ botToken: 'TEST', chatId: '@my_studio_channel', apiBase: `http://127.0.0.1:${server.address().port}` });
  const out = await tg.publish({ text: 'hello' });
  server.close();
  assert.equal(received.url, '/botTEST/sendMessage');
  assert.deepEqual(received.body, { chat_id: '@my_studio_channel', text: 'hello' });
  assert.deepEqual(out, { externalId: '42', url: 'https://t.me/my_studio_channel/42' });
  assert.equal(TelegramPublisher.messageLink({ id: -1001234567890 }, 7), 'https://t.me/c/1234567890/7');
});

test('Telegram 4xx is a definite failure; 5xx is ambiguous', async () => {
  for (const [status, ambiguous] of [[400, false], [502, true]]) {
    const server = http.createServer((req, res) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, description: 'nope' }));
    });
    await new Promise((r) => server.listen(0, r));
    const tg = new TelegramPublisher({ botToken: 'T', chatId: '@c', apiBase: `http://127.0.0.1:${server.address().port}` });
    await assert.rejects(tg.publish({ text: 'x' }), (e) => e.ambiguous === ambiguous);
    server.close();
  }
});
