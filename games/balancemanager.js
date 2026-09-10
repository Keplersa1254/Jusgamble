'use strict';

/**
 * BalanceManager - MongoDB/Mongoose-backed balance & economy system.
 *
 * All user balances, daily streaks, and lifetime stats live in MongoDB Atlas.
 * New users start at 1000 credits. Level is derived from totalEarned (lifetime),
 * so spending or losing never decreases a user's level.
 */

const User = require('../models/User');
const { RARITY_ORDER, RARITIES, randomReward } = require('./crates');

const STARTING_BALANCE = 1000;

// Daily streak system
const DAILY_COOLDOWN_MS   = 86400000;  // 24 hours between claims
const STREAK_WINDOW_MS    = 172800000; // 48 hours before streak resets
const STREAK_BASE         = 1000;      // base chips at streak = 1
const STREAK_INCREMENT    = 200;       // +200 per consecutive day
const STREAK_CAP          = 5000;      // max chips / day

class BalanceManager {
    constructor() {
        /** @type {Function|null} Optional observer fired on every balance change. */
        this.onTransaction = null;
    }

    /**
     * Gets a user's balance. Auto-creates the user if they don't exist.
     * @param {string} userId
     * @returns {Promise<number>}
     */
    async getBalance(userId) {
        const user = await User.findOne({ userId }).lean();
        if (!user) {
            await User.create({ userId, balance: STARTING_BALANCE, hasPlayed: false });
            return STARTING_BALANCE;
        }
        return user.balance;
    }

    /**
     * Gets a user's full document (or null if they don't exist).
     * @param {string} userId
     * @returns {Promise<Object|null>}
     */
    async getUser(userId) {
        return User.findOne({ userId }).lean();
    }

    /**
     * Updates a user's balance atomically. Creates the user if missing.
     * Tracks lifetime earned/spent and fires the onTransaction observer.
     * @param {string} userId
     * @param {number} newBalance
     * @returns {Promise<{balance: number, oldBalance: number}>}
     */
    async updateBalance(userId, newBalance) {
        const old = await User.findOne({ userId }).lean();
        const oldBalance = old ? old.balance : 0;

        await User.findOneAndUpdate(
            { userId },
            {
                $set: { balance: newBalance, hasPlayed: true },
                $setOnInsert: { userId, totalEarned: 0, createdAt: new Date() }
            },
            { upsert: true, new: true }
        );

        if (newBalance > oldBalance) {
            await User.findOneAndUpdate({ userId }, { $inc: { totalEarned: newBalance - oldBalance } });
        }
        if (newBalance < oldBalance) {
            await User.findOneAndUpdate({ userId }, { $inc: { totalSpent: oldBalance - newBalance } });
        }

        if (typeof this.onTransaction === 'function') {
            try { await this.onTransaction(userId, oldBalance, newBalance); } catch (_) { /* never break a payout */ }
        }

        return { balance: newBalance, oldBalance };
    }

    /**
     * Claims the daily streak reward.
     * @param {string} userId
     * @returns {Promise<{claimed: boolean, amount: number, balance: number, streak: number, nextClaim: number}>}
     */
    async claimDaily(userId) {
        const now = Date.now();

        let user = await User.findOne({ userId }).lean();
        if (!user) {
            user = await User.create({ userId, balance: STARTING_BALANCE, lastDaily: 0, dailyStreak: 0, hasPlayed: false });
        }

        const lastClaim = user.lastDaily || 0;

        // Cooldown: less than 24h since last claim.
        if (lastClaim > 0 && now - lastClaim < DAILY_COOLDOWN_MS) {
            const nextClaim = lastClaim + DAILY_COOLDOWN_MS;
            return { claimed: false, amount: 0, balance: user.balance, nextClaim, streak: user.dailyStreak || 0 };
        }

        // Determine streak.
        let streak = user.dailyStreak || 0;
        if (lastClaim === 0 || now - lastClaim > STREAK_WINDOW_MS) {
            streak = 1;
        } else {
            streak += 1;
        }

        const amount = Math.min(STREAK_BASE + (streak - 1) * STREAK_INCREMENT, STREAK_CAP);
        const newBalance = user.balance + amount;

        await User.findOneAndUpdate(
            { userId },
            {
                $set: { balance: newBalance, lastDaily: now, dailyStreak: streak, hasPlayed: true, updatedAt: new Date() },
                $inc: { totalEarned: amount },
                $setOnInsert: { userId, createdAt: new Date() }
            },
            { upsert: true }
        );

        const nextClaim = now + DAILY_COOLDOWN_MS;
        return { claimed: true, amount, balance: newBalance, streak, nextClaim };
    }

    /**
     * Checks if a user can afford a bet.
     * @param {string} userId
     * @param {number} amount
     * @returns {Promise<{canAfford: boolean, balance: number}>}
     */
    async canAfford(userId, amount) {
        const balance = await this.getBalance(userId);
        return { canAfford: balance >= amount, balance };
    }

    /**
     * Transfers credits between users.
     * @param {string} fromUserId
     * @param {string} toUserId
     * @param {number} amount
     * @returns {Promise<{success: boolean, fromBalance: number, toBalance: number, error?: string}>}
     */
    async transfer(fromUserId, toUserId, amount) {
        // getBalance() auto-creates users with the starting balance, matching
        // the original economy rule (new accounts receive 1000 chips).
        const fromBalance = await this.getBalance(fromUserId);
        if (fromBalance < amount) {
            const toUser = await User.findOne({ userId: toUserId }).lean();
            return { success: false, fromBalance, toBalance: toUser ? toUser.balance : 0, error: 'Insufficient funds' };
        }

        const toBalance = await this.getBalance(toUserId);
        await this.updateBalance(fromUserId, fromBalance - amount);
        await this.updateBalance(toUserId, toBalance + amount);

        return { success: true, fromBalance: fromBalance - amount, toBalance: toBalance + amount };
    }

    /**
     * Grants one unopened crate of the given rarity to a user.
     * Auto-creates the user if missing.
     * @param {string} userId
     * @param {string} rarity one of RARITY_ORDER
     * @returns {Promise<Object>} the user's crate inventory after granting
     */
    async grantCrate(userId, rarity) {
        if (!RARITIES[rarity]) throw new Error('Unknown crate rarity: ' + rarity);

        // Ensure the user exists (applies schema defaults, incl. crate counts).
        await this.getBalance(userId);

        await User.findOneAndUpdate(
            { userId },
            { $inc: { ['crates.' + rarity]: 1 } }
        );

        return this.getCrates(userId);
    }

    /**
     * Returns a user's unopened crate counts keyed by rarity (always 6 keys).
     * Does NOT auto-create the user; a missing user simply has zero crates.
     * @param {string} userId
     * @returns {Promise<Object>} e.g. { common: 0, uncommon: 1, ... }
     */
    async getCrates(userId) {
        const user = await User.findOne({ userId }).lean();
        const counts = {};
        for (const key of RARITY_ORDER) {
            counts[key] = (user && user.crates && user.crates[key]) || 0;
        }
        return counts;
    }

    /**
     * Opens one crate of the given rarity: atomically deducts 1 crate and
     * credits a random reward within the rarity's range to the user's balance.
     * @param {string} userId
     * @param {string} rarity one of RARITY_ORDER
     * @returns {Promise<{success: boolean, rarity?: string, reward?: number, balance?: number, remaining?: number, error?: string}>}
     */
    async openCrate(userId, rarity) {
        if (!RARITIES[rarity]) {
            return { success: false, error: 'INVALID_RARITY' };
        }

        const cratePath = 'crates.' + rarity;

        // Atomically deduct 1 crate only if the user owns at least one.
        const user = await User.findOneAndUpdate(
            { userId, [cratePath]: { $gt: 0 } },
            { $inc: { [cratePath]: -1 } },
            { returnDocument: 'after', lean: true }
        );

        if (!user) {
            const existing = await User.findOne({ userId }).lean();
            if (!existing) return { success: false, error: 'NO_USER' };
            return { success: false, error: 'NO_CRATES' };
        }

        const reward = randomReward(rarity);
        const updated = await this.updateBalance(userId, user.balance + reward);

        return {
            success: true,
            rarity: rarity,
            reward: reward,
            balance: updated.balance,
            remaining: (user.crates && user.crates[rarity]) || 0
        };
    }

    /**
     * Returns all users who have played, sorted by balance (highest first).
     * @returns {Promise<Array<{userId: string, balance: number, dailyStreak: number, hasPlayed: boolean}>>}
     */
    async getAllUsers() {
        const users = await User.find({ hasPlayed: true })
            .select('userId balance dailyStreak hasPlayed')
            .lean();
        return users.map(u => ({
            userId: u.userId,
            balance: u.balance || 0,
            dailyStreak: u.dailyStreak || 0,
            hasPlayed: !!u.hasPlayed
        })).sort((a, b) => b.balance - a.balance);
    }
}

module.exports = BalanceManager;
module.exports.STREAK_BASE = STREAK_BASE;
module.exports.STREAK_INCREMENT = STREAK_INCREMENT;
module.exports.STREAK_CAP = STREAK_CAP;
module.exports.DAILY_COOLDOWN_MS = DAILY_COOLDOWN_MS;
module.exports.STREAK_WINDOW_MS = STREAK_WINDOW_MS;


