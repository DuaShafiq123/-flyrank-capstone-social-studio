'use strict';
const { openDb } = require('./db');
const { PublisherRegistry } = require('./adapters/registry');

/** Everything a service needs, created once per process. */
function createContext(config, { role = 'api' } = {}) {
  const db = openDb(config.dbFile);
  const registry = new PublisherRegistry(config, db);
  return { config, db, registry, role };
}

module.exports = { createContext };
