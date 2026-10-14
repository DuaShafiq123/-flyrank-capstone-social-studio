'use strict';
const crypto = require('crypto');
const cheerio = require('cheerio');
const { HttpError } = require('../errors');
const { nowIso } = require('../db');
const { analyze } = require('./markdown');

const toDto = (row) => row && { ...row, tags: JSON.parse(row.tags) };

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const clean = String(t).replace(/^#/, '').trim();
    if (clean && !seen.has(clean.toLowerCase())) { seen.add(clean.toLowerCase()); out.push(clean); }
  }
  return out.slice(0, 10);
}

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new HttpError(400, 'INVALID_URL', `"${url}" is not a valid URL`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'INVALID_URL', 'Only http and https URLs are supported');
  return u;
}

/** Saves the single source of truth. Same content twice = same post (ingestion is idempotent too). */
function storePost(ctx, { sourceType, sourceUrl, title, body, tags }) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) {
    throw new HttpError(422, 'NO_TITLE', 'The post needs a title: add a "# Heading" line, a front-matter "title:", or a "title" field');
  }
  if (!body || body.trim().length < 50) {
    throw new HttpError(422, 'POST_TOO_SHORT', 'Not enough article text found (need at least 50 characters)');
  }
  const hash = crypto.createHash('sha256').update([cleanTitle, sourceUrl || '', body].join('\n')).digest('hex');
  const existing = ctx.db.prepare('SELECT * FROM posts WHERE content_hash = ?').get(hash);
  if (existing) return { post: toDto(existing), created: false };

  const info = ctx.db.prepare(`INSERT INTO posts (source_type, source_url, title, body_markdown, tags, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sourceType, sourceUrl || null, cleanTitle, body, JSON.stringify(normalizeTags(tags)), hash, nowIso());
  return { post: getPost(ctx, info.lastInsertRowid), created: true };
}

function ingestMarkdown(ctx, { markdown, url, title, tags, sourceType = 'markdown' }) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new HttpError(400, 'INVALID_POST', 'Send "markdown" (string) or "url"');
  }
  const a = analyze(markdown);
  const sourceUrl = url || a.meta.url || null;
  if (sourceUrl) checkUrl(sourceUrl);
  return storePost(ctx, {
    sourceType,
    sourceUrl,
    title: title || a.title,
    body: a.body,
    tags: tags || a.meta.tags || [],
  });
}

/** Turns an HTML article into simple Markdown: headings, paragraphs, list items. */
function htmlToMarkdown(html) {
  const $ = cheerio.load(html);
  const meta = (sel) => ($(sel).attr('content') || '').trim();
  const title = meta('meta[property="og:title"]') || $('h1').first().text().trim() || $('title').first().text().trim();
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const tags = [
    ...meta('meta[name="keywords"]').split(','),
    ...$('meta[property="article:tag"]').map((_, e) => $(e).attr('content')).get(),
  ].map((s) => String(s).trim()).filter(Boolean);

  $('script, style, noscript, nav, footer, aside, form, svg, iframe, pre').remove();
  let root = $('article').first();
  if (!root.length) root = $('main').first();
  if (!root.length) root = $('body');

  const lines = [];
  root.find('h1, h2, h3, p, li').each((_, el) => {
    const tag = el.name;
    if (tag === 'p' && $(el).parents('li').length) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (tag === 'h1') { if (text !== title) lines.push(`## ${text}`); }
    else if (tag === 'h2' || tag === 'h3') lines.push(`## ${text}`);
    else if (tag === 'li') lines.push(`- ${text}`);
    else lines.push(text);
    lines.push('');
  });
  let markdown = lines.join('\n');
  if (description && !markdown.includes(description)) markdown = `${description}\n\n${markdown}`;
  return { title, markdown, tags };
}

async function ingestUrl(ctx, url) {
  const u = checkUrl(url);
  let res;
  try {
    res = await fetch(u, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'SocialMediaStudio/1.0 (capstone)', accept: 'text/html,text/markdown,text/plain' },
    });
  } catch (err) {
    throw new HttpError(502, 'FETCH_FAILED', `Could not fetch ${u.href}: ${(err.cause && err.cause.code) || err.message}`);
  }
  if (!res.ok) throw new HttpError(502, 'FETCH_FAILED', `${u.href} returned HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const raw = await res.text();
  if (raw.length > 3_000_000) throw new HttpError(413, 'TOO_LARGE', 'Page is larger than 3 MB');

  if (/markdown|text\/plain/.test(type) || /\.md$/i.test(u.pathname)) {
    return ingestMarkdown(ctx, { markdown: raw, url: u.href, sourceType: 'url' });
  }
  const page = htmlToMarkdown(raw);
  return storePost(ctx, { sourceType: 'url', sourceUrl: u.href, title: page.title, body: page.markdown, tags: page.tags });
}

function getPost(ctx, id) {
  return toDto(ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
}

function listPosts(ctx) {
  return ctx.db.prepare('SELECT * FROM posts ORDER BY id DESC').all().map(toDto);
}

module.exports = { ingestMarkdown, ingestUrl, htmlToMarkdown, getPost, listPosts };
