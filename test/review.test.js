'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCtx, SAMPLE } = require('./helpers');
const { ingestMarkdown } = require('../src/services/ingest');
const { generateVariants, approveVariant, rejectVariant, editVariant, getVariant } = require('../src/services/variants');
const { scheduleVariant, getSlot } = require('../src/services/scheduling');
const { publishSlot } = require('../src/services/publisher');

function draft(ctx, platform = 'x') {
  const { post } = ingestMarkdown(ctx, { markdown: SAMPLE });
  return generateVariants(ctx, post.id, [platform]).created[0];
}

test('PROBE 3: scheduling an unapproved (draft) variant is refused with 409', () => {
  const ctx = makeCtx();
  const v = draft(ctx);
  assert.throws(() => scheduleVariant(ctx, v.id, { inMinutes: 2 }), (err) => {
    assert.equal(err.status, 409);
    assert.equal(err.code, 'VARIANT_NOT_APPROVED');
    console.log('    refused with:', err.message);
    return true;
  });
});

test('a rejected variant cannot be scheduled; an approved one can', () => {
  const ctx = makeCtx();
  const v = draft(ctx);
  rejectVariant(ctx, v.id, 'off-brand');
  assert.throws(() => scheduleVariant(ctx, v.id, { inMinutes: 2 }), { status: 409 });

  const v2 = draft(ctx, 'linkedin');
  approveVariant(ctx, v2.id);
  const { slot, created } = scheduleVariant(ctx, v2.id, { inMinutes: 2 });
  assert.equal(created, true);
  assert.equal(slot.status, 'scheduled');
});

test('repeating the same schedule request returns the same slot (no duplicate slot)', () => {
  const ctx = makeCtx();
  const v = draft(ctx);
  approveVariant(ctx, v.id);
  const at = new Date(Date.now() + 3600000).toISOString();
  const a = scheduleVariant(ctx, v.id, { at });
  const b = scheduleVariant(ctx, v.id, { at });
  assert.equal(a.slot.id, b.slot.id);
  assert.equal(b.created, false);
  assert.throws(() => scheduleVariant(ctx, v.id, { inMinutes: 600 }), { code: 'ALREADY_SCHEDULED' });
});

test('editing an approved variant sends it back to draft and cancels its slot', () => {
  const ctx = makeCtx();
  const v = draft(ctx);
  approveVariant(ctx, v.id);
  const { slot } = scheduleVariant(ctx, v.id, { inMinutes: 5 });
  const edited = editVariant(ctx, v.id, { text: `${v.text}\n\nUpdated.` });
  assert.equal(edited.status, 'draft');
  assert.equal(getSlot(ctx, slot.id).status, 'cancelled');
});

test('safety gate: if a variant loses approval, its slot never publishes', async () => {
  const ctx = makeCtx();
  const v = draft(ctx);
  approveVariant(ctx, v.id);
  const { slot } = scheduleVariant(ctx, v.id, { inMinutes: 0 });
  // Simulate someone flipping the status behind the API's back.
  ctx.db.prepare(`UPDATE variants SET status = 'draft' WHERE id = ?`).run(v.id);
  const r = await publishSlot(ctx, slot.id);
  assert.equal(r.outcome, 'refused');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM mock_posts').get().n, 0);
  assert.equal(getVariant(ctx, v.id).status, 'draft');
});
