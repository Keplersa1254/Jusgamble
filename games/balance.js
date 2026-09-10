'use strict';

/**
 * Shared singleton BalanceManager instance.
 * All commands and games require this module to access the same
 * MongoDB Atlas-backed balance system.
 */

const BalanceManager = require('./balancemanager');

const balanceManager = new BalanceManager();

// With Mongoose, the store is ready as soon as the mongoose connection is
// open (handled in src/index.js). The .ready promise resolves immediately;
// commands should still await it for a consistent API.
balanceManager.ready = Promise.resolve();

module.exports = balanceManager;
