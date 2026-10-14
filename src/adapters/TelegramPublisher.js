'use strict';
const { SocialPublisher } = require('./SocialPublisher');
const { PublishError } = require('../errors');
const { toPublishError } = require('./http');

/** REAL adapter: posts to your own Telegram channel through the Bot API (sendMessage). */
class TelegramPublisher extends SocialPublisher {
  constructor({ botToken, chatId, apiBase = 'https://api.telegram.org' }) {
    super();
    this.botToken = botToken;
    this.chatId = chatId;
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  get name() {
    return 'telegram';
  }

  async publish({ text, signal }) {
    if (!this.botToken || !this.chatId) {
      throw new PublishError('telegram: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env', { ambiguous: false });
    }
    let res;
    try {
      res = await fetch(`${this.apiBase}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text }),
        signal,
      });
    } catch (err) {
      throw toPublishError(err, this.name); // the URL contains the token, so we never log it
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      // 4xx = Telegram refused it (nothing posted). 5xx = unclear.
      throw new PublishError(`telegram: API ${res.status} — ${body.description || 'unknown error'}`, { ambiguous: res.status >= 500 });
    }
    const msg = body.result;
    return { externalId: String(msg.message_id), url: TelegramPublisher.messageLink(msg.chat, msg.message_id) };
  }

  /** The Bot API cannot search what a bot sent, so after a crash we honestly answer "unknown". */
  async reconcile() {
    return { status: 'unknown', reason: 'The Telegram Bot API cannot look up a sent message by idempotency key' };
  }

  static messageLink(chat, messageId) {
    if (chat && chat.username) return `https://t.me/${chat.username}/${messageId}`;
    const id = String(chat && chat.id);
    if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}/${messageId}`;
    return null;
  }
}

module.exports = { TelegramPublisher };
