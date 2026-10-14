'use strict';
const { profiles } = require('./profiles');

const URL_RE = /https?:\/\/[^\s]+/g;
const HASHTAG_RE = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]+)/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const SHOUT_RE = /\b[A-Z]{4,}\b/g;
// Tech acronyms are not shouting.
const ACRONYMS = new Set(['HTTP', 'HTTPS', 'JSON', 'HTML', 'REST', 'CRUD', 'APIS', 'YAML', 'GRPC', 'OAUTH', 'NGINX', 'UUID', 'CORS', 'AJAX']);

const chars = (s) => Array.from(s).length; // count code points, not UTF-16 units

/** Length as the platform counts it (X weighs every URL as 23 characters). */
function measureLength(profile, text) {
  let t = String(text);
  if (profile.urlWeight) t = t.replace(URL_RE, 'x'.repeat(profile.urlWeight));
  return chars(t);
}

const findHashtags = (text) => [...String(text).matchAll(HASHTAG_RE)].map((m) => `#${m[2]}`);
const countEmojis = (text) => (String(text).match(EMOJI_RE) || []).length;
const withoutUrls = (text) => String(text).replace(URL_RE, ' ');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Check one variant against its platform profile.
 * Every violation names the rule it broke, e.g. "x.maxLength".
 */
function validateVariant(platform, text, { sourceUrl } = {}) {
  const profile = profiles[platform];
  if (!profile) {
    return {
      ok: false,
      platform,
      violations: [{ rule: 'platform', message: `Unknown platform "${platform}". Known platforms: ${Object.keys(profiles).join(', ')}` }],
    };
  }
  const violations = [];
  const add = (rule, message, extra = {}) => violations.push({ rule: `${platform}.${rule}`, message, ...extra });

  if (typeof text !== 'string' || !text.trim()) {
    add('notEmpty', 'Variant text is empty');
    return { ok: false, platform, violations };
  }

  const length = measureLength(profile, text);
  if (length > profile.maxLength) {
    add('maxLength', `Variant is ${length} characters; the limit is ${profile.maxLength} (${length - profile.maxLength} over)`, { actual: length, limit: profile.maxLength });
  }
  if (length < profile.minLength) {
    add('minLength', `Variant is ${length} characters; the minimum is ${profile.minLength}`, { actual: length, limit: profile.minLength });
  }

  const hashtags = findHashtags(text);
  if (hashtags.length > profile.maxHashtags) {
    add('maxHashtags', `Variant has ${hashtags.length} hashtags; the limit is ${profile.maxHashtags}`, { actual: hashtags.length, limit: profile.maxHashtags });
  }
  if (hashtags.length < profile.minHashtags) {
    add('minHashtags', `Variant has ${hashtags.length} hashtags; at least ${profile.minHashtags} required`, { actual: hashtags.length, limit: profile.minHashtags });
  }

  const tone = profile.tone;
  const plain = withoutUrls(text);
  const exclamations = (plain.match(/!/g) || []).length;
  if (exclamations > tone.maxExclamations) {
    add('tone.maxExclamations', `Tone "${tone.name}" allows ${tone.maxExclamations} exclamation mark(s); found ${exclamations}`, { actual: exclamations, limit: tone.maxExclamations });
  }
  const emojis = countEmojis(plain);
  if (emojis > tone.maxEmojis) {
    add('tone.maxEmojis', `Tone "${tone.name}" allows ${tone.maxEmojis} emoji(s); found ${emojis}`, { actual: emojis, limit: tone.maxEmojis });
  }
  const shouting = (plain.match(SHOUT_RE) || []).filter((w) => !ACRONYMS.has(w));
  if (shouting.length > tone.maxShoutingWords) {
    add('tone.noShouting', `Tone "${tone.name}" allows ${tone.maxShoutingWords} ALL-CAPS word(s); found ${shouting.length}: ${shouting.join(', ')}`, { actual: shouting.length, limit: tone.maxShoutingWords });
  }
  const banned = tone.bannedPhrases.filter((p) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(plain));
  if (banned.length) {
    add('tone.bannedPhrases', `Tone "${tone.name}" does not allow: ${banned.map((b) => `"${b}"`).join(', ')}`, { found: banned });
  }

  if (profile.requireLink && sourceUrl && !text.includes(sourceUrl)) {
    add('requireLink', `Variant must link back to the source post (${sourceUrl})`);
  }

  return { ok: violations.length === 0, platform, length, hashtags: hashtags.length, violations };
}

function formatViolations(platform, violations) {
  const list = violations.map((v) => `${v.rule}: ${v.message}`).join('; ');
  return `Variant for "${platform}" breaks ${violations.length} rule(s) — ${list}`;
}

module.exports = { validateVariant, formatViolations, measureLength, findHashtags, countEmojis, EMOJI_RE };
