'use strict';

/** Reads an optional "---" front matter block (title, url, tags). */
function parseFrontMatter(md) {
  const m = String(md).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: String(md) };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (!mm) continue;
    let value = mm[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, '');
    }
    meta[mm[1].toLowerCase()] = value;
  }
  return { meta, body: String(md).slice(m[0].length) };
}

/** Removes inline Markdown: links, images, code, bold, italics. */
function stripInline(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a Markdown document into title, headings, paragraphs and bullets. Code blocks are skipped. */
function analyze(md) {
  const { meta, body } = parseFrontMatter(md);
  let title = meta.title || null;
  const headings = [];
  const paragraphs = [];
  const bullets = [];
  let inCode = false;
  let buf = [];
  const flush = () => {
    if (buf.length) {
      const text = stripInline(buf.join(' '));
      if (text) paragraphs.push(text);
      buf = [];
    }
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('```')) { flush(); inCode = !inCode; continue; }
    if (inCode) continue;
    if (!line) { flush(); continue; }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      flush();
      const text = stripInline(m[2]);
      if (m[1].length === 1 && !title) title = text;
      else if (m[1].length > 1) headings.push(text);
      continue;
    }
    m = line.match(/^([-*+]|\d+\.)\s+(.*)$/);
    if (m) { flush(); bullets.push(stripInline(m[2])); continue; }
    buf.push(line.replace(/^>\s?/, ''));
  }
  flush();
  return { meta, body, title, headings, paragraphs, bullets };
}

module.exports = { parseFrontMatter, stripInline, analyze };
