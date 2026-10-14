'use strict';
const { publishSlot, dueSlotIds } = require('../services/publisher');
const { log } = require('../log');

/**
 * Polls the durable job store (the slots table) and publishes due slots.
 * All state lives in SQLite, so a restarted worker continues exactly where the old one stopped.
 */
class Worker {
  constructor(ctx, { id = `worker-${process.pid}`, logger = log('worker') } = {}) {
    this.ctx = ctx;
    this.id = id;
    this.log = logger;
    this.stopping = false;
    this.current = null;
    this.timer = null;
  }

  /** One pass: publish every due slot in the batch, unless asked to stop. */
  async tick() {
    const ids = dueSlotIds(this.ctx.db, this.ctx.config.worker.batchSize);
    let processed = 0;
    for (const id of ids) {
      if (this.stopping) {
        this.log(`stop requested — leaving ${ids.length - processed} due slot(s) for the next run`);
        break;
      }
      const r = await publishSlot(this.ctx, id, { owner: this.id });
      processed += 1;
      const url = r.publication && r.publication.external_url ? ` ${r.publication.external_url}` : '';
      this.log(`slot ${id}: ${r.outcome}${r.error ? ` — ${r.error}` : ''}${url}`);
    }
    return processed;
  }

  start() {
    const loop = () => {
      if (this.stopping) return;
      this.current = this.tick()
        .catch((err) => this.log(`tick failed: ${err.stack || err.message}`))
        .finally(() => {
          this.current = null;
          if (!this.stopping) this.timer = setTimeout(loop, this.ctx.config.worker.pollMs);
        });
    };
    loop();
  }

  /** Graceful stop: finish the publish in flight, claim nothing new. */
  async stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    if (this.current) await this.current;
  }

  /** Process until nothing is due (used by tests and `npm run worker -- --drain`). */
  async drain() {
    while ((await this.tick()) > 0) { /* keep going */ }
  }
}

module.exports = { Worker };
