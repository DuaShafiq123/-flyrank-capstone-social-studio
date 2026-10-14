'use strict';
// Seeds one sample post and generates its variants. Safe to run twice.
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createContext } = require('../src/context');
const { ingestMarkdown } = require('../src/services/ingest');
const { generateVariants, listVariants } = require('../src/services/variants');

const ctx = createContext(loadConfig(), { role: 'seed' });
const markdown = fs.readFileSync(path.join(__dirname, '..', 'samples', 'caching-in-nodejs.md'), 'utf8');
const { post, created } = ingestMarkdown(ctx, { markdown });
console.log(`${created ? 'Stored' : 'Already had'} post ${post.id}: "${post.title}"`);

if (created) {
  const r = generateVariants(ctx, post.id);
  r.created.forEach((v) => console.log(`  variant ${v.id} [${v.platform}] draft, ${Array.from(v.text).length} chars`));
  r.blocked.forEach((b) => console.log(`  BLOCKED [${b.platform}] ${b.message}`));
} else {
  listVariants(ctx, post.id).forEach((v) => console.log(`  variant ${v.id} [${v.platform}] ${v.status}`));
}
console.log('\nNext: POST /variants/<id>/approve, then POST /variants/<id>/schedule');
ctx.db.close();
