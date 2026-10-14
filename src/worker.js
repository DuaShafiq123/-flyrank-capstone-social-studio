'use strict';
const { loadConfig } = require('./config');
const { createContext } = require('./context');
const { Worker } = require('./scheduler/worker');
const { log } = require('./log');

const say = log('worker');
const ctx = createContext(loadConfig(), { role: 'worker' });
const worker = new Worker(ctx);

say(`started as ${worker.id}; adapters: ${JSON.stringify(ctx.config.adapters)}; polling every ${ctx.config.worker.pollMs} ms`);

if (process.argv.includes('--drain')) {
  worker.drain().then(() => {
    say('drain complete');
    ctx.db.close();
    process.exit(0);
  });
} else {
  worker.start();
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      say('second signal — exiting immediately');
      process.exit(130);
    }
    shuttingDown = true;
    say(`${signal} received — finishing the publish in flight, then exiting`);
    await worker.stop();
    ctx.db.close();
    say('stopped cleanly');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
