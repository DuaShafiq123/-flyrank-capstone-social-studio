'use strict';
const express = require('express');
const { HttpError } = require('./errors');
const { profiles } = require('./constraints/profiles');
const { validateVariant, formatViolations } = require('./constraints/validate');
const { ingestMarkdown, ingestUrl, getPost, listPosts } = require('./services/ingest');
const variants = require('./services/variants');
const scheduling = require('./services/scheduling');
const { publishSlot, resolveSlot } = require('./services/publisher');
const { listHistory, historySummary } = require('./services/history');
const { historyPage, mockPostPage } = require('./views');

const id = (req, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'INVALID_ID', `"${req.params[name]}" is not a valid id`);
  return n;
};
const body = (req) => req.body || {};

function buildRouter(ctx) {
  const r = express.Router();

  r.get('/', (req, res) => res.json({
    name: 'Social Media Studio',
    endpoints: [
      'GET  /health', 'GET  /profiles', 'POST /validate',
      'POST /posts', 'GET  /posts', 'GET  /posts/:id',
      'POST /posts/:id/variants', 'POST /posts/:id/variants/manual', 'GET  /posts/:id/variants',
      'GET  /variants/:id', 'PATCH /variants/:id', 'POST /variants/:id/approve', 'POST /variants/:id/reject', 'POST /variants/:id/schedule',
      'GET  /slots', 'GET  /slots/:id', 'DELETE /slots/:id', 'POST /slots/:id/publish-now', 'POST /slots/:id/resolve',
      'GET  /history', 'GET  /history?format=html', 'GET  /history/summary',
      'GET  /mock/:adapter/posts', 'GET  /mock/:adapter/preview',
    ],
  }));

  r.get('/health', (req, res) => res.json({ ok: true, adapters: ctx.config.adapters, platforms: ctx.config.platforms }));
  r.get('/profiles', (req, res) => res.json({ profiles }));

  // Dry-run a text against a profile without saving anything.
  r.post('/validate', (req, res) => {
    const { platform, text, sourceUrl } = body(req);
    const result = validateVariant(platform, text, { sourceUrl });
    res.status(result.ok ? 200 : 422).json(result.ok ? result : { ...result, message: formatViolations(platform, result.violations) });
  });

  // ---- Ingestion ----
  r.post('/posts', async (req, res) => {
    const b = body(req);
    let result;
    if (typeof b.markdown === 'string') result = ingestMarkdown(ctx, b);
    else if (typeof b.url === 'string') result = await ingestUrl(ctx, b.url);
    else throw new HttpError(400, 'INVALID_POST', 'Send { "url": "https://..." } or { "markdown": "# Title ..." }');
    res.status(result.created ? 201 : 200).json(result);
  });
  r.get('/posts', (req, res) => res.json({ posts: listPosts(ctx) }));
  r.get('/posts/:id', (req, res) => {
    const post = getPost(ctx, id(req));
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', `Post ${req.params.id} does not exist`);
    res.json({ post });
  });

  // ---- Variants ----
  r.post('/posts/:id/variants', (req, res) => {
    const result = variants.generateVariants(ctx, id(req), body(req).platforms);
    res.status(result.created.length ? 201 : 422).json(result);
  });
  r.post('/posts/:id/variants/manual', (req, res) => {
    res.status(201).json({ variant: variants.createManualVariant(ctx, id(req), body(req)) });
  });
  r.get('/posts/:id/variants', (req, res) => res.json({ variants: variants.listVariants(ctx, id(req)) }));
  r.get('/variants/:id', (req, res) => res.json({ variant: variants.mustGetVariant(ctx, id(req)) }));

  // ---- Review workflow ----
  r.patch('/variants/:id', (req, res) => res.json({ variant: variants.editVariant(ctx, id(req), body(req)) }));
  r.post('/variants/:id/approve', (req, res) => res.json({ variant: variants.approveVariant(ctx, id(req)) }));
  r.post('/variants/:id/reject', (req, res) => res.json({ variant: variants.rejectVariant(ctx, id(req), body(req).reason) }));

  // ---- Scheduling ----
  r.post('/variants/:id/schedule', (req, res) => {
    const result = scheduling.scheduleVariant(ctx, id(req), body(req));
    res.status(result.created ? 201 : 200).json(result);
  });
  r.get('/slots', (req, res) => res.json({ slots: scheduling.listSlots(ctx, req.query) }));
  r.get('/slots/:id', (req, res) => {
    const slot = scheduling.getSlot(ctx, id(req));
    if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', `Slot ${req.params.id} does not exist`);
    res.json({ slot });
  });
  r.delete('/slots/:id', (req, res) => res.json({ slot: scheduling.cancelSlot(ctx, id(req)) }));

  // Publish a slot right now. Call it 10 times — you still get one post.
  r.post('/slots/:id/publish-now', async (req, res) => {
    const result = await publishSlot(ctx, id(req), { owner: 'api', force: true });
    const status = { published: 201, duplicate: 200, reconciled: 200, ambiguous: 202, uncertain: 202, busy: 409, refused: 409, failed: 502, not_found: 404 }[result.outcome] || 200;
    res.status(status).json({ ...result, duplicate: result.outcome === 'duplicate' });
  });

  r.post('/slots/:id/resolve', (req, res) => {
    const { delivered, externalUrl } = body(req);
    if (typeof delivered !== 'boolean') throw new HttpError(400, 'INVALID_BODY', 'Send { "delivered": true | false, "externalUrl"?: "..." }');
    const result = resolveSlot(ctx, id(req), { delivered, externalUrl });
    if (result.outcome === 'not_found') throw new HttpError(404, 'SLOT_NOT_FOUND', `Slot ${req.params.id} does not exist`);
    if (result.outcome === 'invalid') throw new HttpError(409, 'INVALID_TRANSITION', `Slot ${req.params.id} is "${result.slot.status}"; only needs_attention slots can be resolved`);
    res.json(result);
  });

  // ---- History ----
  r.get('/history', (req, res) => {
    const rows = listHistory(ctx, req.query);
    if (req.query.format === 'html') return res.type('html').send(historyPage(rows));
    return res.json({ attempts: rows });
  });
  r.get('/history/summary', (req, res) => res.json({ slots: historySummary(ctx) }));

  // ---- Mock platform previews ----
  const mockPosts = (adapter) => ctx.db.prepare('SELECT * FROM mock_posts WHERE adapter = ? ORDER BY id DESC').all(adapter);
  r.get('/mock/:adapter/posts', (req, res) => res.json({ posts: mockPosts(req.params.adapter) }));
  r.get('/mock/:adapter/preview', (req, res) => res.type('html').send(mockPostPage(req.params.adapter, mockPosts(req.params.adapter))));
  r.get('/mock/:adapter/posts/:postId', (req, res) => {
    const post = ctx.db.prepare('SELECT * FROM mock_posts WHERE adapter = ? AND id = ?').get(req.params.adapter, id(req, 'postId'));
    if (!post) throw new HttpError(404, 'NOT_FOUND', 'Mock post not found');
    res.type('html').send(mockPostPage(req.params.adapter, [post]));
  });

  return r;
}

module.exports = { buildRouter };
