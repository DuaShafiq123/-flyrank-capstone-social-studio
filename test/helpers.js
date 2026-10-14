'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createContext } = require('../src/context');
const { ingestMarkdown } = require('../src/services/ingest');
const { generateVariants, approveVariant } = require('../src/services/variants');
const { scheduleVariant } = require('../src/services/scheduling');

const ROOT = path.join(__dirname, '..');
const SAMPLE = fs.readFileSync(path.join(ROOT, 'samples', 'caching-in-nodejs.md'), 'utf8');

const tmpDbFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')), 'test.db');

// Tests never touch real platforms: telegram is mapped to a mock unless a test says otherwise.
const TEST_ENV = {
  ADAPTERS: 'x=mock_x,linkedin=mock_linkedin,telegram=mock_x',
  PLATFORMS: 'x,linkedin,telegram',
  PUBLIC_BASE_URL: 'http://test.local',
  WORKER_RETRY_BACKOFF_MS: '0',
  WORKER_LEASE_MS: '60000',
  SIM_CRASH_AFTER_SEND: '',
  SIM_MOCK_TIMEOUT_ONCE: '',
  SIM_SEND_DELAY_MS: '0',
};

function makeCtx(overrides = {}, role = 'test') {
  return createContext(loadConfig({ ...TEST_ENV, DB_FILE: tmpDbFile(), ...overrides }), { role });
}

/** Ingest the sample, generate one variant per platform, approve and schedule them now. */
function scheduledCampaign(ctx, platforms = ['x']) {
  const { post } = ingestMarkdown(ctx, { markdown: SAMPLE });
  const { created } = generateVariants(ctx, post.id, platforms);
  return created.map((v) => {
    approveVariant(ctx, v.id);
    return scheduleVariant(ctx, v.id, { inMinutes: 0 }).slot;
  });
}

const mockPostCount = (ctx, key) =>
  ctx.db.prepare('SELECT COUNT(*) AS n FROM mock_posts WHERE idempotency_key = ?').get(key).n;

module.exports = { ROOT, SAMPLE, TEST_ENV, tmpDbFile, makeCtx, scheduledCampaign, mockPostCount };
