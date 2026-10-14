'use strict';
const { HttpError } = require('../errors');
const { nowIso } = require('../db');
const { profiles } = require('../constraints/profiles');
const { validateVariant, formatViolations } = require('../constraints/validate');
const { generateText } = require('./generator');
const { getPost } = require('./ingest');

function getVariant(ctx, id) {
  return ctx.db.prepare('SELECT * FROM variants WHERE id = ?').get(id);
}

function mustGetVariant(ctx, id) {
  const v = getVariant(ctx, id);
  if (!v) throw new HttpError(404, 'VARIANT_NOT_FOUND', `Variant ${id} does not exist`);
  return v;
}

function mustGetPost(ctx, id) {
  const post = getPost(ctx, id);
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', `Post ${id} does not exist`);
  return post;
}

function insertVariant(ctx, { postId, platform, text, origin }) {
  const now = nowIso();
  const info = ctx.db.prepare(`INSERT INTO variants (post_id, platform, text, status, origin, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, ?, ?)`).run(postId, platform, text, origin, now, now);
  return getVariant(ctx, info.lastInsertRowid);
}

function assertValid(platform, text, sourceUrl) {
  const check = validateVariant(platform, text, { sourceUrl });
  if (!check.ok) {
    throw new HttpError(422, 'CONSTRAINT_VIOLATION', formatViolations(platform, check.violations), { violations: check.violations });
  }
}

/** Generates one variant per platform. Rule-breaking variants are blocked and never stored. */
function generateVariants(ctx, postId, platforms) {
  const post = mustGetPost(ctx, postId);
  const list = Array.isArray(platforms) && platforms.length ? platforms : ctx.config.platforms;
  const unknown = list.filter((p) => !profiles[p]);
  if (unknown.length) throw new HttpError(400, 'UNKNOWN_PLATFORM', `Unknown platform(s): ${unknown.join(', ')}. Known: ${Object.keys(profiles).join(', ')}`);

  const created = [];
  const blocked = [];
  for (const platform of list) {
    const text = generateText(post, platform);
    const check = validateVariant(platform, text, { sourceUrl: post.source_url });
    if (!check.ok) {
      blocked.push({ platform, text, message: formatViolations(platform, check.violations), violations: check.violations });
      continue;
    }
    created.push(insertVariant(ctx, { postId: post.id, platform, text, origin: 'template' }));
  }
  return { postId: post.id, created, blocked };
}

/** A human writes the variant text. Same rules apply. */
function createManualVariant(ctx, postId, { platform, text }) {
  const post = mustGetPost(ctx, postId);
  assertValid(platform, text, post.source_url);
  return insertVariant(ctx, { postId: post.id, platform, text, origin: 'manual' });
}

function listVariants(ctx, postId) {
  mustGetPost(ctx, postId);
  return ctx.db.prepare('SELECT * FROM variants WHERE post_id = ? ORDER BY id').all(postId);
}

function cancelOpenSlots(ctx, variantId, reason) {
  ctx.db.prepare(`UPDATE slots SET status = 'cancelled', last_error = ?, updated_at = ?
    WHERE variant_id = ? AND status = 'scheduled'`).run(reason, nowIso(), variantId);
}

function assertNotInFlight(ctx, v) {
  const busy = ctx.db.prepare(`SELECT id FROM slots WHERE variant_id = ? AND status IN ('claimed', 'needs_attention')`).get(v.id);
  if (busy) throw new HttpError(409, 'PUBLISH_IN_PROGRESS', `Variant ${v.id} is being published right now (slot ${busy.id})`);
}

function approveVariant(ctx, id) {
  const v = mustGetVariant(ctx, id);
  if (v.status === 'approved') return v; // approving twice is harmless
  if (v.status !== 'draft') {
    throw new HttpError(409, 'INVALID_TRANSITION', `Variant ${id} is "${v.status}"; only a draft can be approved`);
  }
  ctx.db.prepare(`UPDATE variants SET status = 'approved', reviewed_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), id);
  return getVariant(ctx, id);
}

function rejectVariant(ctx, id, reason) {
  const v = mustGetVariant(ctx, id);
  if (v.status === 'published') throw new HttpError(409, 'INVALID_TRANSITION', `Variant ${id} is already published`);
  assertNotInFlight(ctx, v);
  ctx.db.transaction(() => {
    ctx.db.prepare(`UPDATE variants SET status = 'rejected', reject_reason = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
      .run(reason || null, nowIso(), nowIso(), id);
    cancelOpenSlots(ctx, id, 'Variant was rejected');
  })();
  return getVariant(ctx, id);
}

/** Editing re-validates and sends the variant back to draft: changed text needs a fresh approval. */
function editVariant(ctx, id, { text }) {
  const v = mustGetVariant(ctx, id);
  if (v.status === 'published') throw new HttpError(409, 'INVALID_TRANSITION', `Variant ${id} is already published and cannot be edited`);
  assertNotInFlight(ctx, v);
  const post = getPost(ctx, v.post_id);
  assertValid(v.platform, text, post.source_url);
  ctx.db.transaction(() => {
    ctx.db.prepare(`UPDATE variants SET text = ?, status = 'draft', reviewed_at = NULL, reject_reason = NULL, updated_at = ? WHERE id = ?`)
      .run(text, nowIso(), id);
    cancelOpenSlots(ctx, id, 'Variant was edited and needs a new approval');
  })();
  return getVariant(ctx, id);
}

module.exports = {
  generateVariants, createManualVariant, listVariants, getVariant, mustGetVariant,
  approveVariant, rejectVariant, editVariant,
};
