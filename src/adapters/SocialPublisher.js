'use strict';

/**
 * The ONE interface the app talks to. The app never knows which platform is behind it.
 *
 * publish({ text, idempotencyKey, platform, signal })
 *   -> Promise<{ externalId: string, url: string|null }>
 *   Must throw PublishError. Set ambiguous=true when the platform MAY have accepted the post.
 *
 * reconcile(idempotencyKey)
 *   -> Promise<{ status: 'found', externalId, url } | { status: 'not_found' } | { status: 'unknown', reason }>
 *   Called after a crash/timeout to ask: "did my earlier attempt actually land?"
 */
class SocialPublisher {
  get name() {
    throw new Error(`${this.constructor.name} must define a name`);
  }

  // eslint-disable-next-line no-unused-vars
  async publish(input) {
    throw new Error(`${this.constructor.name}.publish() is not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async reconcile(idempotencyKey) {
    return { status: 'unknown', reason: `${this.name} cannot look up earlier posts` };
  }
}

module.exports = { SocialPublisher };
