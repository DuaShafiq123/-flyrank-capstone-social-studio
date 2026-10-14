'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateVariant } = require('../src/constraints/validate');
const { makeCtx, SAMPLE } = require('./helpers');
const { ingestMarkdown } = require('../src/services/ingest');
const { generateVariants, createManualVariant } = require('../src/services/variants');

const URL = 'https://example.com/blog/caching-in-nodejs';
const rules = (r) => r.violations.map((v) => v.rule);

test('PROBE 1: every generated variant passes its constraint profile', () => {
  const ctx = makeCtx();
  const { post } = ingestMarkdown(ctx, { markdown: SAMPLE });
  const { created, blocked } = generateVariants(ctx, post.id);
  assert.deepEqual(created.map((v) => v.platform), ['x', 'linkedin', 'telegram']);
  assert.equal(blocked.length, 0);
  for (const v of created) {
    const check = validateVariant(v.platform, v.text, { sourceUrl: post.source_url });
    assert.ok(check.ok, `${v.platform}: ${JSON.stringify(check.violations)}`);
    assert.equal(v.status, 'draft');
  }
  assert.equal(new Set(created.map((v) => v.text)).size, 3, 'variants differ per platform');
});

test('PROBE 2: an over-length X variant is blocked and the error names x.maxLength', () => {
  const ctx = makeCtx();
  const { post } = ingestMarkdown(ctx, { markdown: SAMPLE });
  const text = `${'Caching makes Node fast. '.repeat(12)}${URL} #nodejs`;
  assert.throws(() => createManualVariant(ctx, post.id, { platform: 'x', text }), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.code, 'CONSTRAINT_VIOLATION');
    assert.match(err.message, /x\.maxLength/);
    console.log('    blocked with:', err.message);
    return true;
  });
  const stored = ctx.db.prepare('SELECT COUNT(*) AS n FROM variants').get().n;
  assert.equal(stored, 0, 'a blocked variant never reaches review');
});

test('too many hashtags is blocked with x.maxHashtags', () => {
  const r = validateVariant('x', `Caching tips for Node ${URL} #a1 #b2 #c3`, { sourceUrl: URL });
  assert.deepEqual(rules(r), ['x.maxHashtags']);
});

test('tone rules: banned phrase, emojis, shouting, exclamations', () => {
  const li = validateVariant('linkedin', `${'A professional note about caching. '.repeat(10)} omg this is gonna be big 🚀 ${URL} #a #b #c`, { sourceUrl: URL });
  assert.ok(rules(li).includes('linkedin.tone.bannedPhrases'));
  assert.ok(rules(li).includes('linkedin.tone.maxEmojis'));

  const x = validateVariant('x', `CACHING IS AMAZING!! ${URL} #nodejs`, { sourceUrl: URL });
  assert.ok(rules(x).includes('x.tone.noShouting'));
  assert.ok(rules(x).includes('x.tone.maxExclamations'));
});

test('X counts every link as 23 characters', () => {
  const longUrl = `https://example.com/${'a'.repeat(300)}`;
  const r = validateVariant('x', `Short and sweet caching tip for everyone. ${longUrl} #nodejs`, { sourceUrl: longUrl });
  assert.ok(r.ok, JSON.stringify(r.violations));
});

test('a variant must link back to the source post', () => {
  const r = validateVariant('telegram', 'A friendly note about caching without any link to the actual article itself, sadly.', { sourceUrl: URL });
  assert.deepEqual(rules(r), ['telegram.requireLink']);
});
