'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');
const { ROOT, TEST_ENV, tmpDbFile, makeCtx, scheduledCampaign, mockPostCount } = require('./helpers');
const { openDb } = require('../src/db');
const { Worker } = require('../src/scheduler/worker');

const silent = () => {};

test('PROBE 5: worker process dies right after sending; restart finishes the batch with zero duplicates', async () => {
  const dbFile = tmpDbFile();
  const ctx = makeCtx({ DB_FILE: dbFile });
  const slots = scheduledCampaign(ctx, ['x', 'linkedin', 'telegram']);
  ctx.db.close();

  const env = { ...process.env, ...TEST_ENV, DB_FILE: dbFile, WORKER_LEASE_MS: '300' };
  const worker = path.join(ROOT, 'src', 'worker.js');

  // Run 1: crashes after the FIRST post is accepted, before its result is saved.
  const run1 = spawnSync(process.execPath, [worker, '--drain'], { env: { ...env, SIM_CRASH_AFTER_SEND: '1' }, encoding: 'utf8' });
  assert.equal(run1.status, 97, 'first worker crashed mid-batch');

  await sleep(400); // let the dead worker's lease expire

  // Run 2: a fresh worker continues.
  const run2 = spawnSync(process.execPath, [worker, '--drain'], { env, encoding: 'utf8' });
  assert.equal(run2.status, 0, run2.stderr);
  console.log(run2.stdout.trim().split('\n').map((l) => `    ${l}`).join('\n'));

  const db = openDb(dbFile);
  for (const s of slots) {
    const row = db.prepare('SELECT status FROM slots WHERE id = ?').get(s.id);
    const posts = db.prepare('SELECT COUNT(*) AS n FROM mock_posts WHERE idempotency_key = ?').get(s.idempotency_key).n;
    const ok = db.prepare(`SELECT COUNT(*) AS n FROM publications WHERE idempotency_key = ? AND status = 'succeeded'`).get(s.idempotency_key).n;
    assert.equal(row.status, 'published');
    assert.equal(posts, 1, `slot ${s.id} posted exactly once`);
    assert.equal(ok, 1);
  }
  const reconciled = db.prepare(`SELECT COUNT(*) AS n FROM publish_attempts WHERE outcome = 'reconciled'`).get().n;
  assert.equal(reconciled, 1, 'the crashed send was found, not resent');
  db.close();
});

test('graceful stop mid-batch (Ctrl+C), then restart: every slot posted exactly once', async () => {
  const ctx = makeCtx({ SIM_SEND_DELAY_MS: '150' });
  const slots = scheduledCampaign(ctx, ['x', 'linkedin', 'telegram']);

  const w1 = new Worker(ctx, { id: 'w1', logger: silent });
  w1.start();
  await sleep(200);
  await w1.stop();
  const doneAfterStop = slots.filter((s) => ctx.db.prepare('SELECT status FROM slots WHERE id = ?').get(s.id).status === 'published').length;
  assert.ok(doneAfterStop >= 1 && doneAfterStop < 3, `stopped mid-batch (published ${doneAfterStop}/3)`);

  const w2 = new Worker(ctx, { id: 'w2', logger: silent });
  await w2.drain();
  for (const s of slots) assert.equal(mockPostCount(ctx, s.idempotency_key), 1);
});

test('a worker that dies holding a lease: another worker takes over after the lease expires', async () => {
  const ctx = makeCtx({ WORKER_LEASE_MS: '100' });
  const [slot] = scheduledCampaign(ctx, ['x']);
  // Worker A claims the slot and "dies" before doing anything.
  const { claimSlot } = require('../src/services/publisher');
  assert.ok(claimSlot(ctx.db, slot.id, 'dead-worker', 100));
  await sleep(150);
  await new Worker(ctx, { id: 'w2', logger: silent }).drain();
  assert.equal(mockPostCount(ctx, slot.idempotency_key), 1);
});
