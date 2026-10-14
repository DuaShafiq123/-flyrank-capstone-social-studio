'use strict';
require('dotenv').config();

/** "x=mock_x,telegram=telegram" -> { x: 'mock_x', telegram: 'telegram' } */
function parseAdapterMap(str) {
  const map = {};
  for (const pair of String(str).split(',').map((s) => s.trim()).filter(Boolean)) {
    const [platform, adapter] = pair.split('=').map((s) => (s || '').trim());
    if (!platform || !adapter) {
      throw new Error(`Invalid ADAPTERS entry "${pair}". Expected platform=adapter, e.g. telegram=telegram`);
    }
    map[platform] = adapter;
  }
  return map;
}

const num = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

/** All configuration comes from the environment (12-factor). Tests pass overrides. */
function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const port = num(env.PORT, 3000);
  return {
    port,
    dbFile: env.DB_FILE || './data/studio.db',
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    platforms: String(env.PLATFORMS || 'x,linkedin,telegram').split(',').map((s) => s.trim()).filter(Boolean),
    adapters: parseAdapterMap(env.ADAPTERS || 'x=mock_x,linkedin=mock_linkedin,telegram=telegram'),
    telegram: { botToken: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '' },
    discord: { webhookUrl: env.DISCORD_WEBHOOK_URL || '', guildId: env.DISCORD_GUILD_ID || '' },
    publishTimeoutMs: num(env.PUBLISH_TIMEOUT_MS, 15000),
    worker: {
      pollMs: num(env.WORKER_POLL_MS, 5000),
      batchSize: num(env.WORKER_BATCH_SIZE, 10),
      leaseMs: num(env.WORKER_LEASE_MS, 60000),
      maxAttempts: num(env.WORKER_MAX_ATTEMPTS, 5),
      retryBackoffMs: num(env.WORKER_RETRY_BACKOFF_MS, 30000),
    },
    sim: {
      crashAfterSend: env.SIM_CRASH_AFTER_SEND === '1',
      mockTimeoutOnce: env.SIM_MOCK_TIMEOUT_ONCE === '1',
      sendDelayMs: num(env.SIM_SEND_DELAY_MS, 0),
    },
  };
}

module.exports = { loadConfig, parseAdapterMap };
