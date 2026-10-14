'use strict';
const { loadConfig } = require('./config');
const { createContext } = require('./context');
const { createApp } = require('./app');
const { log } = require('./log');

const say = log('api');
const ctx = createContext(loadConfig(), { role: 'api' });
const server = createApp(ctx).listen(ctx.config.port, () => {
  say(`listening on http://localhost:${ctx.config.port} — adapters: ${JSON.stringify(ctx.config.adapters)}`);
});

const shutdown = () => server.close(() => { ctx.db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
