'use strict';

/** An error that the API turns into an HTTP response. */
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown by adapters.
 * ambiguous = true  -> the platform MAY have accepted the post (timeout, connection reset, 5xx).
 * ambiguous = false -> we know nothing was posted (bad token, DNS failure, 4xx).
 */
class PublishError extends Error {
  constructor(message, { ambiguous = false } = {}) {
    super(message);
    this.name = 'PublishError';
    this.ambiguous = ambiguous;
  }
}

module.exports = { HttpError, PublishError };
