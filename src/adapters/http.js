'use strict';
const { PublishError } = require('../errors');

// These failures happen BEFORE a request reaches the platform, so nothing was posted.
const DEFINITELY_NOT_SENT = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
]);

/** Turn a fetch() failure into a PublishError that says whether the post may have landed. */
function toPublishError(err, adapterName) {
  if (err instanceof PublishError) return err;
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new PublishError(`${adapterName}: request timed out — the post may or may not have been delivered`, { ambiguous: true });
  }
  const code = (err && err.cause && err.cause.code) || (err && err.code);
  if (DEFINITELY_NOT_SENT.has(code)) {
    return new PublishError(`${adapterName}: could not reach the API (${code}); nothing was sent`, { ambiguous: false });
  }
  return new PublishError(`${adapterName}: network error (${code || (err && err.message)}); delivery unknown`, { ambiguous: true });
}

module.exports = { toPublishError };
