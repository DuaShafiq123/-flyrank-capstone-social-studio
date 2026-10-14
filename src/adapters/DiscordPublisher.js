'use strict';
const { SocialPublisher } = require('./SocialPublisher');
const { PublishError } = require('../errors');
const { toPublishError } = require('./http');

/** Optional REAL adapter: one POST to a webhook in your own Discord server. */
class DiscordPublisher extends SocialPublisher {
  constructor({ webhookUrl, guildId }) {
    super();
    this.webhookUrl = webhookUrl;
    this.guildId = guildId;
  }

  get name() {
    return 'discord';
  }

  async publish({ text, signal }) {
    if (!this.webhookUrl) throw new PublishError('discord: DISCORD_WEBHOOK_URL must be set in .env', { ambiguous: false });
    const url = `${this.webhookUrl}${this.webhookUrl.includes('?') ? '&' : '?'}wait=true`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
        signal,
      });
    } catch (err) {
      throw toPublishError(err, this.name);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PublishError(`discord: API ${res.status} — ${body.message || 'unknown error'}`, { ambiguous: res.status >= 500 });
    }
    const link = this.guildId ? `https://discord.com/channels/${this.guildId}/${body.channel_id}/${body.id}` : null;
    return { externalId: String(body.id), url: link };
  }
}

module.exports = { DiscordPublisher };
