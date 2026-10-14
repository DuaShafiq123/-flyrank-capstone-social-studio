'use strict';
const log = (scope) => (...args) => console.log(new Date().toISOString(), `[${scope}]`, ...args);
module.exports = { log };
