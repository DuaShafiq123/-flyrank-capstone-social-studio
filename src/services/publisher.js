'use strict';
/*
 * The idempotent publish service — the heart of the system.
 *
 * It only ever talks to ctx.registry (the SocialPublisher interface).
 * It never imports a concrete adapter, so swapping adapters touches zero lines here.
 *
 * Guarantees:
 *  1. Claim: a slot is claimed with an atomic UPDATE + lease. Two workers cannot both own it.
 *  2. Intent: a 'sending' publication row is written BEFORE the network call.
 *     One row per idempotency key (UNIQUE), so one (variant, slot) = at most one post.
 *  3. Recovery: if a 'sending' row is found later (crash or timeout), we ask the adapter
 *     to reconcile before sending again:
 *       found     -> record the existing post, do NOT resend
 *       not_found -> safe to send
 *       unknown   -> do NOT resend; mark needs_attention for a human (at-most-once)
 *  4. Safety gate: an unapproved variant never goes out, even if a slot exists.
 */
const { setTimeout: sleep } = require('timers/promises');
const { nowIso } = require('../db');
const { PublishError } = require('../errors');

const q = {
  slot: (db, id) => db.prepare('SELECT * FROM slots WHERE id = ?').get(id),
  variant: (db, id) => db.prepare('SELECT * FROM variants WHERE id = ?').get(id),
  publication: (db, key) => db.prepare('SELECT * FROM publications WHERE idempotency_key = ?').get(key),
};

function recordAttempt(db, slot, { adapter = null, owner = null, outcome, detail = null, externalUrl = null }) {
  db.prepare(`INSERT INTO publish_attempts (slot_id, variant_id, idempotency_key, adapter, worker, outcome, detail, external_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(slot.id, slot.variant_id, slot.idempotency_key, adapter, owner, outcome, detail, externalUrl, nowIso());
}

/** Atomic claim. Returns true only for the one caller that wins. Expired leases can be taken over. */
function claimSlot(db, slotId, owner, leaseMs, { force = false } = {}) {
  const now = nowIso();
  const due = force ? `status = 'scheduled'` : `(status = 'scheduled' AND next_attempt_at <= @now)`;
  const r = db.prepare(`UPDATE slots
    SET status = 'claimed', lease_owner = @owner, lease_until = @until, attempts = attempts + 1, updated_at = @now
    WHERE id = @id AND (${due} OR (status = 'claimed' AND lease_until < @now))`)
    .run({ id: slotId, owner, now, until: new Date(Date.now() + leaseMs).toISOString() });
  return r.changes === 1;
}

/** Slots the worker should handle now: due ones, plus ones whose worker died (expired lease). */
function dueSlotIds(db, limit) {
  const now = nowIso();
  return db.prepare(`SELECT id FROM slots
    WHERE (status = 'scheduled' AND next_attempt_at <= @now) OR (status = 'claimed' AND lease_until < @now)
    ORDER BY next_attempt_at, id LIMIT @limit`).all({ now, limit }).map((r) => r.id);
}

function markSucceeded(db, slot, publicationId, { externalId = null, url = null }) {
  db.transaction(() => {
    const now = nowIso();
    db.prepare(`UPDATE publications SET status = 'succeeded', external_id = COALESCE(?, external_id),
      external_url = COALESCE(?, external_url), error = NULL, updated_at = ? WHERE id = ?`).run(externalId, url, now, publicationId);
    db.prepare(`UPDATE slots SET status = 'published', lease_owner = NULL, lease_until = NULL, last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(now, slot.id);
    db.prepare(`UPDATE variants SET status = 'published', updated_at = ? WHERE id = ?`).run(now, slot.variant_id);
  })();
}

function releaseForRetry(db, config, slot, error) {
  const fresh = q.slot(db, slot.id);
  const now = nowIso();
  if (fresh.attempts >= config.worker.maxAttempts) {
    db.prepare(`UPDATE slots SET status = 'failed', lease_owner = NULL, lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(error, now, slot.id);
    return 'failed';
  }
  const next = new Date(Date.now() + config.worker.retryBackoffMs * fresh.attempts).toISOString();
  db.prepare(`UPDATE slots SET status = 'scheduled', next_attempt_at = ?, lease_owner = NULL, lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(next, error, now, slot.id);
  return 'scheduled';
}

function markNeedsAttention(db, slot, reason) {
  db.prepare(`UPDATE slots SET status = 'needs_attention', lease_owner = NULL, lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(reason, nowIso(), slot.id);
}

/** Entry point for the worker AND for POST /slots/:id/publish-now. Safe to call any number of times. */
async function publishSlot(ctx, slotId, { owner = 'api', force = false } = {}) {
  const { db, config } = ctx;
  if (!q.slot(db, slotId)) return { outcome: 'not_found' };

  if (!claimSlot(db, slotId, owner, config.worker.leaseMs, { force })) {
    const slot = q.slot(db, slotId);
    if (slot.status === 'published') {
      const pub = q.publication(db, slot.idempotency_key);
      recordAttempt(db, slot, { adapter: pub && pub.adapter, owner, outcome: 'duplicate_skipped', detail: 'Slot already published; repeated request ignored', externalUrl: pub && pub.external_url });
      return { outcome: 'duplicate', slot, publication: pub };
    }
    return { outcome: 'busy', slot };
  }

  const slot = q.slot(db, slotId);
  try {
    return await runClaimed(ctx, slot, owner);
  } catch (err) {
    // A bug, not a platform error. Release the lease; the publication row (if any) keeps us safe.
    recordAttempt(db, slot, { owner, outcome: 'failed', detail: `Internal error: ${err.message}` });
    releaseForRetry(db, config, slot, err.message);
    return { outcome: 'failed', error: err.message };
  }
}

async function runClaimed(ctx, slot, owner) {
  const { db, config, registry } = ctx;
  const variant = q.variant(db, slot.variant_id);

  // Safety gate: nothing unapproved ever goes out.
  if (!variant || !['approved', 'published'].includes(variant.status)) {
    const reason = `Variant is "${variant && variant.status}"; unapproved variants are never published`;
    db.prepare(`UPDATE slots SET status = 'cancelled', lease_owner = NULL, lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(reason, nowIso(), slot.id);
    recordAttempt(db, slot, { owner, outcome: 'refused', detail: reason });
    return { outcome: 'refused', error: reason };
  }

  const key = slot.idempotency_key;
  let pub = q.publication(db, key);

  if (pub && pub.status === 'succeeded') {
    markSucceeded(db, slot, pub.id, {});
    recordAttempt(db, slot, { adapter: pub.adapter, owner, outcome: 'duplicate_skipped', detail: 'Already published under this idempotency key', externalUrl: pub.external_url });
    return { outcome: 'duplicate', publication: q.publication(db, key) };
  }

  if (pub && pub.status === 'sending') {
    // An earlier attempt reached the network call and never recorded a result. Did it land?
    let rec;
    try {
      rec = await registry.get(pub.adapter).reconcile(key);
    } catch (err) {
      rec = { status: 'unknown', reason: err.message };
    }
    if (rec.status === 'found') {
      markSucceeded(db, slot, pub.id, rec);
      const done = q.publication(db, key);
      recordAttempt(db, slot, { adapter: pub.adapter, owner, outcome: 'reconciled', detail: 'Earlier attempt had already posted; not resending', externalUrl: done.external_url });
      return { outcome: 'reconciled', publication: done };
    }
    if (rec.status !== 'not_found') {
      const reason = `Earlier attempt via ${pub.adapter} may have been delivered and it cannot be verified (${rec.reason}). `
        + `Not resending. Check the channel, then POST /slots/${slot.id}/resolve`;
      markNeedsAttention(db, slot, reason);
      recordAttempt(db, slot, { adapter: pub.adapter, owner, outcome: 'uncertain', detail: reason });
      return { outcome: 'uncertain', error: reason };
    }
    // not_found: the earlier attempt never landed, so sending now is safe.
  }

  let adapterName;
  let publisher;
  try {
    adapterName = registry.adapterNameFor(variant.platform);
    publisher = registry.get(adapterName);
  } catch (err) {
    recordAttempt(db, slot, { owner, outcome: 'failed', detail: err.message });
    releaseForRetry(db, config, slot, err.message);
    return { outcome: 'failed', error: err.message };
  }

  if (config.sim.sendDelayMs) await sleep(config.sim.sendDelayMs);

  // Intent BEFORE dispatch. From here on, a crash leaves a 'sending' row behind.
  const now = nowIso();
  if (pub) {
    db.prepare(`UPDATE publications SET status = 'sending', adapter = ?, error = NULL, updated_at = ? WHERE id = ?`).run(adapterName, now, pub.id);
  } else {
    db.prepare(`INSERT INTO publications (idempotency_key, slot_id, variant_id, adapter, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'sending', ?, ?)`).run(key, slot.id, slot.variant_id, adapterName, now, now);
  }
  pub = q.publication(db, key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.publishTimeoutMs);
  let result;
  try {
    result = await publisher.publish({ text: variant.text, idempotencyKey: key, platform: variant.platform, signal: controller.signal });
  } catch (raw) {
    const err = raw instanceof PublishError ? raw : new PublishError(raw.message, { ambiguous: true });
    if (err.ambiguous) {
      // Keep the 'sending' row: the next attempt will reconcile before it sends anything.
      const next = releaseForRetry(db, config, slot, err.message);
      recordAttempt(db, slot, { adapter: adapterName, owner, outcome: 'ambiguous', detail: `${err.message} (slot ${next})` });
      return { outcome: 'ambiguous', error: err.message };
    }
    db.prepare(`UPDATE publications SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(err.message, nowIso(), pub.id);
    const next = releaseForRetry(db, config, slot, err.message);
    recordAttempt(db, slot, { adapter: adapterName, owner, outcome: 'failed', detail: `${err.message} (slot ${next})` });
    return { outcome: 'failed', error: err.message };
  } finally {
    clearTimeout(timer);
  }

  if (config.sim.crashAfterSend && ctx.role === 'worker') {
    // Failure simulation: the platform has the post, but we die before saving the result.
    console.error(`[sim] SIM_CRASH_AFTER_SEND: exiting after sending slot ${slot.id}, before recording the result`);
    process.exit(97);
  }

  markSucceeded(db, slot, pub.id, result);
  const done = q.publication(db, key);
  recordAttempt(db, slot, { adapter: adapterName, owner, outcome: 'success', detail: `Published via ${adapterName}`, externalUrl: done.external_url });
  return { outcome: 'published', publication: done };
}

/** A human settles a needs_attention slot after checking the real channel. */
function resolveSlot(ctx, slotId, { delivered, externalUrl }) {
  const { db } = ctx;
  const slot = q.slot(db, slotId);
  if (!slot) return { outcome: 'not_found' };
  if (slot.status !== 'needs_attention') return { outcome: 'invalid', slot };
  const pub = q.publication(db, slot.idempotency_key);
  if (delivered) {
    markSucceeded(db, slot, pub.id, { url: externalUrl || null });
    recordAttempt(db, slot, { adapter: pub.adapter, owner: 'operator', outcome: 'resolved', detail: 'Operator confirmed the post was delivered', externalUrl: externalUrl || null });
    return { outcome: 'published', slot: q.slot(db, slotId), publication: q.publication(db, slot.idempotency_key) };
  }
  db.transaction(() => {
    const now = nowIso();
    db.prepare(`UPDATE publications SET status = 'failed', error = 'Operator confirmed not delivered', updated_at = ? WHERE id = ?`).run(now, pub.id);
    db.prepare(`UPDATE slots SET status = 'scheduled', next_attempt_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`).run(now, now, slot.id);
  })();
  recordAttempt(db, slot, { adapter: pub.adapter, owner: 'operator', outcome: 'resolved', detail: 'Operator confirmed NOT delivered; slot re-queued' });
  return { outcome: 'requeued', slot: q.slot(db, slotId) };
}

module.exports = { publishSlot, dueSlotIds, claimSlot, resolveSlot };
