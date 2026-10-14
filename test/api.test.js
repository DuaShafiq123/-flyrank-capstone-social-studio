'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCtx, SAMPLE } = require('./helpers');
const { createApp } = require('../src/app');

test('HTTP end-to-end: ingest -> generate -> refuse draft -> approve -> schedule -> publish twice -> history', async () => {
  const ctx = makeCtx();
  const server = createApp(ctx).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  try {
    const post = await call('POST', '/posts', { markdown: SAMPLE });
    assert.equal(post.status, 201);
    assert.equal((await call('POST', '/posts', { markdown: SAMPLE })).status, 200, 'same post twice is not duplicated');

    const gen = await call('POST', `/posts/${post.json.post.id}/variants`);
    assert.equal(gen.status, 201);
    assert.equal(gen.json.created.length, 3);
    const x = gen.json.created.find((v) => v.platform === 'x');

    const bad = await call('POST', `/posts/${post.json.post.id}/variants/manual`, { platform: 'x', text: 'way too long '.repeat(40) });
    assert.equal(bad.status, 422);
    assert.match(bad.json.error.message, /x\.maxLength/);

    const refused = await call('POST', `/variants/${x.id}/schedule`, { inMinutes: 2 });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'VARIANT_NOT_APPROVED');

    assert.equal((await call('POST', `/variants/${x.id}/approve`)).json.variant.status, 'approved');
    const sched = await call('POST', `/variants/${x.id}/schedule`, { inMinutes: 2 });
    assert.equal(sched.status, 201);

    const p1 = await call('POST', `/slots/${sched.json.slot.id}/publish-now`);
    const p2 = await call('POST', `/slots/${sched.json.slot.id}/publish-now`);
    assert.equal(p1.status, 201);
    assert.equal(p2.status, 200);
    assert.equal(p2.json.duplicate, true);
    assert.equal(p1.json.publication.external_url, p2.json.publication.external_url);

    const mock = await call('GET', '/mock/mock_x/posts');
    assert.equal(mock.json.posts.length, 1);

    const summary = await call('GET', '/history/summary');
    assert.equal(summary.json.slots[0].successful_posts, 1);

    assert.equal((await call('GET', '/variants/abc')).status, 400);
    assert.equal((await call('GET', '/nope')).status, 404);
  } finally {
    server.close();
  }
});
