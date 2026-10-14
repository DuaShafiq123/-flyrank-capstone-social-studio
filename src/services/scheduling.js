'use strict';
const { HttpError } = require('../errors');
const { nowIso } = require('../db');
const { mustGetVariant } = require('./variants');

const LIVE = `('scheduled', 'claimed', 'published', 'needs_attention')`;

function parseWhen(body = {}) {
  let d;
  if (body.inMinutes !== undefined) {
    const m = Number(body.inMinutes);
    if (!Number.isFinite(m) || m < 0 || m > 525600) throw new HttpError(400, 'INVALID_TIME', '"inMinutes" must be a number between 0 and 525600');
    d = new Date(Date.now() + m * 60000);
  } else if (body.at) {
    d = new Date(body.at);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'INVALID_TIME', `"at" must be an ISO date-time, e.g. 2026-10-15T09:00:00+05:00`);
  } else {
    throw new HttpError(400, 'INVALID_TIME', 'Send "at" (ISO date-time) or "inMinutes" (number)');
  }
  if (d.getTime() < Date.now() - 60000) throw new HttpError(400, 'INVALID_TIME', `${d.toISOString()} is in the past`);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

function getSlot(ctx, id) {
  return ctx.db.prepare('SELECT * FROM slots WHERE id = ?').get(id);
}

/**
 * Only an APPROVED variant can be scheduled.
 * The idempotency key is derived from (variant, slot time), so repeating the same
 * schedule request returns the same slot instead of creating a second one.
 */
function scheduleVariant(ctx, variantId, body) {
  const v = mustGetVariant(ctx, variantId);
  if (v.status !== 'approved') {
    throw new HttpError(409, 'VARIANT_NOT_APPROVED',
      `Variant ${v.id} is "${v.status}". Only approved variants can be scheduled — approve it first with POST /variants/${v.id}/approve`,
      { status: v.status });
  }
  if (!ctx.config.adapters[v.platform]) {
    throw new HttpError(409, 'NO_ADAPTER', `No adapter is configured for platform "${v.platform}". Add it to ADAPTERS in .env`);
  }
  const at = parseWhen(body);
  const key = `variant-${v.id}@${at}`;

  const same = ctx.db.prepare('SELECT * FROM slots WHERE idempotency_key = ?').get(key);
  if (same) return { slot: same, created: false };

  const live = ctx.db.prepare(`SELECT * FROM slots WHERE variant_id = ? AND status IN ${LIVE}`).get(v.id);
  if (live) {
    throw new HttpError(409, 'ALREADY_SCHEDULED', `Variant ${v.id} already has slot ${live.id} (${live.status}) at ${live.scheduled_at}. Cancel it first with DELETE /slots/${live.id}`, { slot: live });
  }

  const now = nowIso();
  try {
    const info = ctx.db.prepare(`INSERT INTO slots (variant_id, scheduled_at, next_attempt_at, status, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?)`).run(v.id, at, at, key, now, now);
    return { slot: getSlot(ctx, info.lastInsertRowid), created: true };
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      throw new HttpError(409, 'ALREADY_SCHEDULED', `Variant ${v.id} was scheduled by a concurrent request`);
    }
    throw err;
  }
}

function cancelSlot(ctx, slotId) {
  const slot = getSlot(ctx, slotId);
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', `Slot ${slotId} does not exist`);
  const r = ctx.db.prepare(`UPDATE slots SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'scheduled'`).run(nowIso(), slotId);
  if (r.changes !== 1) throw new HttpError(409, 'INVALID_TRANSITION', `Slot ${slotId} is "${slot.status}"; only a scheduled slot can be cancelled`);
  return getSlot(ctx, slotId);
}

/** The calendar: slots with their variant and publication. */
function listSlots(ctx, { from, to, status } = {}) {
  const where = [];
  const params = {};
  if (from) { where.push('s.scheduled_at >= @from'); params.from = new Date(from).toISOString(); }
  if (to) { where.push('s.scheduled_at <= @to'); params.to = new Date(to).toISOString(); }
  if (status) { where.push('s.status = @status'); params.status = status; }
  return ctx.db.prepare(`
    SELECT s.*, v.platform, v.post_id, v.status AS variant_status,
           p.adapter, p.status AS publication_status, p.external_url
    FROM slots s
    JOIN variants v ON v.id = s.variant_id
    LEFT JOIN publications p ON p.idempotency_key = s.idempotency_key
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.scheduled_at, s.id`).all(params);
}

module.exports = { scheduleVariant, cancelSlot, listSlots, getSlot, parseWhen };
