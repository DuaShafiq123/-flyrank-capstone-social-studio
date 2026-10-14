'use strict';

function listHistory(ctx, { variantId, slotId, limit = 200 } = {}) {
  const where = [];
  const params = { limit: Math.min(Number(limit) || 200, 1000) };
  if (variantId) { where.push('a.variant_id = @variantId'); params.variantId = Number(variantId); }
  if (slotId) { where.push('a.slot_id = @slotId'); params.slotId = Number(slotId); }
  return ctx.db.prepare(`
    SELECT a.id, a.created_at, a.slot_id, a.variant_id, v.platform, a.adapter, a.worker,
           a.outcome, a.detail, a.external_url, a.idempotency_key
    FROM publish_attempts a JOIN variants v ON v.id = a.variant_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.id DESC LIMIT @limit`).all(params);
}

/** One row per slot: how many attempts, and how many SUCCESSFUL posts (must be 0 or 1). */
function historySummary(ctx) {
  return ctx.db.prepare(`
    SELECT s.id AS slot_id, s.variant_id, v.platform, s.status AS slot_status, s.idempotency_key,
           COUNT(a.id) AS attempts,
           (SELECT COUNT(*) FROM publications p WHERE p.idempotency_key = s.idempotency_key AND p.status = 'succeeded') AS successful_posts,
           (SELECT external_url FROM publications p WHERE p.idempotency_key = s.idempotency_key) AS external_url
    FROM slots s JOIN variants v ON v.id = s.variant_id
    LEFT JOIN publish_attempts a ON a.slot_id = s.id
    GROUP BY s.id ORDER BY s.id`).all();
}

module.exports = { listHistory, historySummary };
