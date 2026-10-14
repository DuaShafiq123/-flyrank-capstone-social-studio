'use strict';
const express = require('express');
const { buildRouter } = require('./routes');
const { HttpError } = require('./errors');

function createApp(ctx) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(buildRouter(ctx));

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `${req.method} ${req.path} does not exist. GET / lists all endpoints.` } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
  });
  return app;
}

module.exports = { createApp };
