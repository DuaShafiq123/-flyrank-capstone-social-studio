'use strict';
const { SocialPublisher } = require('./SocialPublisher');
const { TelegramPublisher } = require('./TelegramPublisher');
const { DiscordPublisher } = require('./DiscordPublisher');
const { MockXPublisher, MockLinkedInPublisher } = require('./MockPublisher');

/**
 * The ONLY place that knows concrete adapter classes.
 * Adding a platform = write a class + add one line here. Business logic is untouched.
 */
const factories = {
  telegram: (config) => new TelegramPublisher(config.telegram),
  discord: (config) => new DiscordPublisher(config.discord),
  mock_x: (config, db) => new MockXPublisher({ db, baseUrl: config.publicBaseUrl, timeoutOnce: config.sim.mockTimeoutOnce }),
  mock_linkedin: (config, db) => new MockLinkedInPublisher({ db, baseUrl: config.publicBaseUrl, timeoutOnce: config.sim.mockTimeoutOnce }),
};

class PublisherRegistry {
  constructor(config, db) {
    this.config = config;
    this.db = db;
    this.instances = new Map();
    // Fail fast on a typo in ADAPTERS instead of failing at 9am on publish day.
    for (const [platform, name] of Object.entries(config.adapters)) {
      if (!factories[name]) {
        throw new Error(`ADAPTERS maps "${platform}" to unknown adapter "${name}". Known adapters: ${Object.keys(factories).join(', ')}`);
      }
    }
  }

  static knownAdapters() {
    return Object.keys(factories);
  }

  /** Which adapter publishes this platform? Decided by configuration only. */
  adapterNameFor(platform) {
    const name = this.config.adapters[platform];
    if (!name) throw new Error(`No adapter configured for platform "${platform}" (check ADAPTERS in .env)`);
    return name;
  }

  /** @returns {SocialPublisher} */
  get(name) {
    if (!this.instances.has(name)) {
      const factory = factories[name];
      if (!factory) throw new Error(`Unknown adapter "${name}"`);
      this.register(name, factory(this.config, this.db));
    }
    return this.instances.get(name);
  }

  /** Used by get() and by tests that plug in a fake adapter. */
  register(name, instance) {
    if (!(instance instanceof SocialPublisher)) throw new Error(`Adapter "${name}" must extend SocialPublisher`);
    this.instances.set(name, instance);
  }
}

module.exports = { PublisherRegistry };
