'use strict';

/**
 * UserDataManager — MongoDB/Mongoose-backed profile & progress store.
 *
 * Tracks per-user progress (XP, level, games played, wins/losses, wagers).
 * Commands call recordUsage() / recordGameResult(); the profile is read by
 * /profile. Auto-creates users on first activity via upsert.
 */

const User = require('../models/User');

// ── XP / level progression ───────────────────────────────────
const XP_PER_COMMAND = 5;   // every slash command used
const XP_PER_GAME    = 10;  // bonus for starting a game command
const XP_PER_RESULT  = 10;  // bonus when a game outcome is recorded
const LEVEL_XP_STEP  = 50;  // XP to grow from level L to L+1 = STEP * L

/** Slash-command names that count as "games" for progress stats. */
const GAME_COMMANDS = new Set([
    'blackjack',
    'coinflip',
    'coinflip-pvp',
    'dice',
    'roulette',
    'rocket',
    'russian-roulette',
    'russian-roulette-pvp',
    'slots',
    'minesweeper'
]);

/**
 * Cumulative XP required to REACH a level (level 1 = 0 XP).
 * @param {number} level
 * @returns {number}
 */
function xpForLevel(level) {
    if (level <= 1) return 0;
    return (LEVEL_XP_STEP * (level - 1) * level) / 2;
}

/**
 * Highest level reachable with the given total XP.
 * @param {number} xp
 * @returns {number}
 */
function levelFromXp(xp) {
    xp = Math.max(0, xp);
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level++;
    return level;
}

class UserDataManager {
    constructor() {
        /** @type {Promise<void>} Resolves once the store is ready. */
        this.ready = Promise.resolve();
    }

    /**
     * Records that a user ran any slash command. Awards XP and counts game
     * starts. Auto-creates the user if missing.
     * @param {string} userId
     * @param {string} commandName
     * @returns {Promise<Object>} the updated user document
     */
    async recordUsage(userId, commandName) {
        const isGame = GAME_COMMANDS.has(commandName);
        const xpGain = XP_PER_COMMAND + (isGame ? XP_PER_GAME : 0);

        const update = {
            $inc: { xp: xpGain },
            $set: { lastSeen: new Date() },
            $setOnInsert: { userId, balance: 1000, createdAt: new Date() }
        };
        if (isGame) {
            update.$inc.totalGamesPlayed = 1;
        }

        const user = await User.findOneAndUpdate({ userId }, update, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        });

        const newLevel = levelFromXp(user.xp);
        if (newLevel !== user.level) {
            await User.findOneAndUpdate({ userId }, { $set: { level: newLevel } });
            user.level = newLevel;
        }

        return user;
    }

    /**
     * Records a finished game outcome.
     * @param {string} userId
     * @param {string} gameName command name, e.g. 'blackjack'
     * @param {'win'|'loss'|'push'} outcome
     * @param {number} [wager] credits wagered
     * @returns {Promise<Object>} the updated user document
     */
    async recordGameResult(userId, gameName, outcome, wager = 0) {
        const statsPath = `games.${gameName}`;
        const update = {
            $inc: {
                xp: XP_PER_RESULT,
                totalWagered: wager,
                [`${statsPath}.played`]: 1,
                [`${statsPath}.wagers`]: wager
            },
            $set: { lastSeen: new Date() },
            $setOnInsert: { userId, balance: 1000, createdAt: new Date() }
        };

        if (outcome === 'win') {
            update.$inc.totalWins = 1;
            update.$inc[`${statsPath}.wins`] = 1;
        } else if (outcome === 'push') {
            update.$inc[`${statsPath}.pushes`] = 1;
        } else {
            update.$inc.totalLosses = 1;
            update.$inc[`${statsPath}.losses`] = 1;
        }

        const user = await User.findOneAndUpdate({ userId }, update, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        });

        const newLevel = levelFromXp(user.xp);
        if (newLevel !== user.level) {
            await User.findOneAndUpdate({ userId }, { $set: { level: newLevel } });
            user.level = newLevel;
        }

        return user;
    }

    /**
     * Fetches a user's full profile (creating an empty one if needed).
     * @param {string} userId
     * @returns {Promise<Object>}
     */
    async getProfile(userId) {
        let user = await User.findOne({ userId }).lean();
        if (!user) {
            user = await User.create({ userId, balance: 1000, xp: 0, level: 1 });
        }
        return user;
    }

    /**
     * All profiles, sorted by XP (highest first).
     * @returns {Promise<Array<Object>>}
     */
    async getAllUsers() {
        return User.find().sort({ xp: -1 }).lean();
    }
}

// Shared singleton.
const userData = new UserDataManager();

module.exports = userData;
module.exports.UserDataManager = UserDataManager;
module.exports.xpForLevel = xpForLevel;
module.exports.levelFromXp = levelFromXp;
module.exports.XP_PER_COMMAND = XP_PER_COMMAND;
module.exports.XP_PER_GAME = XP_PER_GAME;
module.exports.XP_PER_RESULT = XP_PER_RESULT;
module.exports.LEVEL_XP_STEP = LEVEL_XP_STEP;
module.exports.GAME_COMMANDS = GAME_COMMANDS;