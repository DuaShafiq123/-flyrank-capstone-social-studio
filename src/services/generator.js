'use strict';
const { profiles } = require('../constraints/profiles');
const { measureLength, EMOJI_RE } = require('../constraints/validate');
const { analyze } = require('./markdown');
const { HttpError } = require('../errors');

/*
 * Template-based generator. It reads ONLY the stored post row.
 * Templates try to fit each profile, but validation.js has the final word:
 * whatever a template produces is still checked before it is saved.
 */

const STOPWORDS = new Set(('a an the and or but if then else for to of in on at by with from into over under about how what why '
  + 'when where who which this that these those your you our we is are was were be been being it its as can will just not '
  + 'no yes do does did make use using guide tips practical simple complete part').split(' '));

function toHashtag(word) {
  const parts = String(word).replace(/^#/, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!parts.length) return null;
  return `#${parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('')}`;
}

function pickHashtags(post, a, count) {
  const seen = new Set();
  const out = [];
  const add = (w) => {
    const h = toHashtag(w);
    if (!h || h.length < 4 || seen.has(h.toLowerCase())) return;
    seen.add(h.toLowerCase());
    out.push(h);
  };
  post.tags.forEach(add);
  for (const w of [post.title, ...a.headings].join(' ').split(/[^\p{L}\p{N}.]+/u)) {
    const word = w.replace(/\.+$/, '');
    if (word.length >= 4 && !STOPWORDS.has(word.toLowerCase())) add(word);
  }
  return out.slice(0, count);
}

const summaryOf = (a) => a.paragraphs.find((p) => p.length >= 60) || a.paragraphs[0] || '';
const firstSentence = (p) => ((p.match(/^.*?[.!?](\s|$)/) || [p])[0]).trim();
const stripEmojis = (s) => s.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ');

/** Shrinks the flexible part word by word until the whole text fits the limit. */
function fitToLimit(build, flexible, limit, measure) {
  const words = flexible ? flexible.split(/\s+/) : [];
  let text = build(flexible);
  while (measure(text) > limit && words.length) {
    words.pop();
    text = build(words.length ? `${words.join(' ').replace(/[,;:.!?—-]+$/, '')}…` : '');
  }
  return text;
}

const templates = {
  x(post, a) {
    const p = profiles.x;
    const tags = pickHashtags(post, a, p.maxHashtags);
    const build = (flex) => [flex ? `${post.title} — ${flex}` : post.title, post.source_url, tags.join(' ')]
      .filter(Boolean).join('\n\n');
    return fitToLimit(build, firstSentence(summaryOf(a)), p.maxLength, (t) => measureLength(p, t));
  },

  linkedin(post, a) {
    const p = profiles.linkedin;
    const tags = pickHashtags(post, a, 4);
    const points = (a.headings.length ? a.headings : a.bullets).slice(0, 5);
    const build = (flex) => [
      post.title,
      flex,
      points.length ? `What the article covers:\n${points.map((h) => `• ${h}`).join('\n')}` : '',
      post.source_url ? `Read the full article: ${post.source_url}` : '',
      tags.join(' '),
    ].filter(Boolean).join('\n\n');
    return stripEmojis(fitToLimit(build, a.paragraphs.slice(0, 3).join('\n\n'), p.maxLength, (t) => measureLength(p, t)));
  },

  telegram(post, a) {
    const p = profiles.telegram;
    const tags = pickHashtags(post, a, p.maxHashtags);
    const points = (a.headings.length ? a.headings : a.bullets).slice(0, 3);
    const build = (flex) => [
      `👋 New on the blog: ${post.title}`,
      flex,
      points.length ? `Inside:\n${points.map((h) => `• ${h}`).join('\n')}` : '',
      post.source_url ? `👉 Read it here: ${post.source_url}` : '',
      tags.join(' '),
    ].filter(Boolean).join('\n\n');
    return fitToLimit(build, summaryOf(a), p.maxLength, (t) => measureLength(p, t));
  },
};

function generateText(post, platform) {
  const template = templates[platform];
  if (!template) throw new HttpError(400, 'UNKNOWN_PLATFORM', `No template for platform "${platform}". Known: ${Object.keys(templates).join(', ')}`);
  return template(post, analyze(post.body_markdown));
}

module.exports = { generateText, pickHashtags, toHashtag };
