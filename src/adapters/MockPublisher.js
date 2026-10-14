'use strict';
const { SocialPublisher } = require('./SocialPublisher');
const { PublishError } = require('../errors');
const { nowIso } = require('../db');

/**
 * Base for mock adapters. Instead of calling a real platform, it records what it
 * WOULD post in the mock_posts table and exposes a preview URL.
 * Like a real platform, it does NOT de-duplicate — our publish service must.
 */
class MockPublisher extends SocialPublisher {
  constructor({ db, adapterName, baseUrl, timeoutOnce = false }) {
    super();
    this.db = db;
    this.adapterName = adapterName;
    this.baseUrl = baseUrl;
    this.timeoutOnce = timeoutOnce;
    this.timedOut = false;
  }

  get name() {
    return this.adapterName;
  }

  async publish({ text, idempotencyKey }) {
    const info = this.db
      .prepare('INSERT INTO mock_posts (adapter, idempotency_key, text, created_at) VALUES (?, ?, ?, ?)')
      .run(this.adapterName, idempotencyKey, text, nowIso());
    const id = String(info.lastInsertRowid);

    if (this.timeoutOnce && !this.timedOut) {
      // Failure simulation: the "platform" accepted the post, but the response was lost.
      this.timedOut = true;
      throw new PublishError(`${this.adapterName}: simulated timeout AFTER the post was accepted`, { ambiguous: true });
    }
    return { externalId: id, url: `${this.baseUrl}/mock/${this.adapterName}/posts/${id}` };
  }

  /** A mock can search its own history, like a platform API that supports lookups. */
  async reconcile(idempotencyKey) {
    const row = this.db
      .prepare('SELECT id FROM mock_posts WHERE adapter = ? AND idempotency_key = ? ORDER BY id LIMIT 1')
      .get(this.adapterName, idempotencyKey);
    if (!row) return { status: 'not_found' };
    return { status: 'found', externalId: String(row.id), url: `${this.baseUrl}/mock/${this.adapterName}/posts/${row.id}` };
  }
}

class MockXPublisher extends MockPublisher {
  constructor(opts) {
    super({ ...opts, adapterName: 'mock_x' });
  }
}

class MockLinkedInPublisher extends MockPublisher {
  constructor(opts) {
    super({ ...opts, adapterName: 'mock_linkedin' });
  }
}

module.exports = { MockPublisher, MockXPublisher, MockLinkedInPublisher };
