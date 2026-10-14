'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCtx, scheduledCampaign, mockPostCount } = require('./helpers');
const { publishSlot, resolveSlot } = require('../src/services/publisher');
const { getSlot } = require('../src/services/scheduling');
const { SocialPublisher } = require('../src/adapters/SocialPublisher');
const { PublishError } = require('../src/errors');

test('repeated publish calls for the same variant + slot create exactly one post', async () => {
  const ctx = makeCtx();
  const [slot] = scheduledCampaign(ctx, ['x']);
  const outcomes = [];
  for (let i = 0; i < 5; i += 1) outcomes.push((await publishSlot(ctx, slot.id)).outcome);
  console.log('    outcomes:', outcomes.join(', '));
  assert.deepEqual(outcomes, ['published', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
  assert.equal(mockPostCount(ctx, slot.idempotency_key), 1);
});

test('five concurrent publish calls create exactly one post', async () => {
  const ctx = makeCtx();
  const [slot] = scheduledCampaign(ctx, ['x']);
  const results = await Promise.all(Array.from({ length: 5 }, () => publishSlot(ctx, slot.id)));
  assert.equal(results.filter((r) => r.outcome === 'published').length, 1);
  assert.equal(mockPostCount(ctx, slot.idempotency_key), 1);
});

test('retry after a timeout (post landed, response lost) does not post twice', async () => {
  const ctx = makeCtx({ SIM_MOCK_TIMEOUT_ONCE: '1' });
  const [slot] = scheduledCampaign(ctx, ['x']);
  const first = await publishSlot(ctx, slot.id);
  assert.equal(first.outcome, 'ambiguous');
  assert.equal(getSlot(ctx, slot.id).status, 'scheduled', 'slot is queued for retry');

  const second = await publishSlot(ctx, slot.id);
  assert.equal(second.outcome, 'reconciled', 'retry finds the earlier post instead of resending');
  assert.equal(mockPostCount(ctx, slot.idempotency_key), 1);
  assert.equal(getSlot(ctx, slot.id).status, 'published');
});

/** A "real" platform that cannot be searched after the fact (like Telegram). */
class UnverifiablePublisher extends SocialPublisher {
  constructor() { super(); this.sends = 0; }
  get name() { return 'fake_real'; }
  async publish() {
    this.sends += 1;
    if (this.sends === 1) throw new PublishError('fake_real: request timed out', { ambiguous: true });
    return { externalId: String(this.sends), url: `https://fake.example/${this.sends}` };
  }
}

test('unverifiable platform: an uncertain attempt is NOT resent blindly (at-most-once)', async () => {
  const ctx = makeCtx();
  const fake = new UnverifiablePublisher();
  ctx.registry.register('fake_real', fake);
  ctx.config.adapters.telegram = 'fake_real';
  const [slot] = scheduledCampaign(ctx, ['telegram']);

  assert.equal((await publishSlot(ctx, slot.id)).outcome, 'ambiguous');
  assert.equal((await publishSlot(ctx, slot.id)).outcome, 'uncertain');
  assert.equal(fake.sends, 1, 'no blind resend');
  assert.equal(getSlot(ctx, slot.id).status, 'needs_attention');

  // A human checks the channel: the post is NOT there, so re-queue it.
  assert.equal(resolveSlot(ctx, slot.id, { delivered: false }).outcome, 'requeued');
  assert.equal((await publishSlot(ctx, slot.id)).outcome, 'published');
  assert.equal(fake.sends, 2);
  assert.equal((await publishSlot(ctx, slot.id)).outcome, 'duplicate');
  assert.equal(fake.sends, 2);
});

test('a definite failure (e.g. bad token) is retried, then marked failed after max attempts', async () => {
  const ctx = makeCtx({ WORKER_MAX_ATTEMPTS: '2' });
  ctx.config.adapters.telegram = 'telegram'; // no token configured -> definite failure, no network
  const [slot] = scheduledCampaign(ctx, ['telegram']);
  assert.equal((await publishSlot(ctx, slot.id)).outcome, 'failed');
  assert.equal(getSlot(ctx, slot.id).status, 'scheduled');
  assert.equal((await publishSlot(ctx, slot.id)).outcome, 'failed');
  assert.equal(getSlot(ctx, slot.id).status, 'failed');
});
