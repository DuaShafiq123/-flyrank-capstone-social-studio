'use strict';
// One command for local runs: starts the API and the worker together.
const { fork } = require('child_process');
const path = require('path');

const children = ['server.js', 'worker.js'].map((f) => fork(path.join(__dirname, '..', 'src', f)));
const stop = (sig) => children.forEach((c) => c.connected !== false && c.kill(sig));
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
children.forEach((c) => c.on('exit', (code) => {
  if (code && code !== 0) console.error(`child exited with code ${code}`);
}));
