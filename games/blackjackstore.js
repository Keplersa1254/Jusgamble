'use strict';

/**
 * BlackjackStore - MongoDB/Mongoose-backed storage for active Blackjack games.
 *
 * A TTL index auto-removes games 30 minutes after they're saved, so leftover
 * Discord buttons always resolve to live games across bot restarts. A random
 * game id baked into each button's customId lets us always find the correct
 * game.
 */

const BlackjackGame = require('../models/BlackjackGame');
const { GAME_TTL_MS } = require('../models/BlackjackGame');

class BlackjackStore {
    constructor() {
        /** @type {Promise<void>} Resolves once the store is ready. */
        this.ready = Promise.resolve();
    }

    /**
     * Fetches an active game by id. Expired games (per TTL) are removed.
     * @param {string} gameId
     * @returns {Promise<Object|null>}
     */
    async get(gameId) {
        const entry = await BlackjackGame.findOne({ gameId }).lean();
        if (!entry) return null;
        if (Date.now() - new Date(entry.savedAt).getTime() > GAME_TTL_MS) {
            await this.remove(gameId);
            return null;
        }
        return entry;
    }

    /**
     * Stores or updates a game.
     * @param {string} gameId
     * @param {Object} state Game state to store (includes userId, channelId, bet, etc.).
     * @returns {Promise<void>}
     */
    async save(gameId, state) {
        await BlackjackGame.findOneAndUpdate(
            { gameId },
            { $set: { ...state, savedAt: new Date() } },
            { upsert: true }
        );
    }

    /**
     * Removes a game by id.
     * @param {string} gameId
     * @returns {Promise<void>}
     */
    async remove(gameId) {
        await BlackjackGame.deleteOne({ gameId });
    }

    /**
     * Returns whether the given user already has a live game.
     * @param {string} userId
     * @returns {Promise<boolean>}
     */
    async userHasActiveGame(userId) {
        const cutoff = new Date(Date.now() - GAME_TTL_MS);
        const count = await BlackjackGame.countDocuments({ userId, savedAt: { $gte: cutoff } });
        return count > 0;
    }

    /**
     * Removes all expired games (cleanup safeguard beyond TTL index).
     * @returns {Promise<void>}
     */
    async sweepExpired() {
        const cutoff = new Date(Date.now() - GAME_TTL_MS);
        await BlackjackGame.deleteMany({ savedAt: { $lt: cutoff } });
    }
}

// Shared singleton.
const blackjackStore = new BlackjackStore();
blackjackStore.ready
    .then(() => blackjackStore.sweepExpired())
    .catch(err => console.error('Failed to initialize BlackjackStore:', err));

module.exports = blackjackStore;
module.exports.BlackjackStore = BlackjackStore;
module.exports.GAME_TTL_MS = GAME_TTL_MS;