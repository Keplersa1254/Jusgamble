'use strict';

const mongoose = require('mongoose');

const STARTING_BALANCE = 1000;

const gameStatsSchema = new mongoose.Schema({
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    pushes: { type: Number, default: 0 },
    wagers: { type: Number, default: 0 },
    played: { type: Number, default: 0 }
}, { _id: false });

// Purchased shop roles (owned across the bot — role IDs are globally unique).
const inventoryItemSchema = new mongoose.Schema({
    roleId: { type: String, required: true },
    purchasedAt: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    guildId: { type: String, default: null },
    username: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    balance: { type: Number, default: STARTING_BALANCE },
    totalEarned: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    totalGamesPlayed: { type: Number, default: 0 },
    totalWins: { type: Number, default: 0 },
    totalLosses: { type: Number, default: 0 },
    totalWagered: { type: Number, default: 0 },
    games: { type: Map, of: gameStatsSchema, default: {} },
    inventory: { type: [inventoryItemSchema], default: [] },
    // Unopened crates grouped by rarity (see games/crates.js).
    crates: {
        common:    { type: Number, default: 0 },
        uncommon:  { type: Number, default: 0 },
        rare:      { type: Number, default: 0 },
        epic:      { type: Number, default: 0 },
        legendary: { type: Number, default: 0 },
        mythic:    { type: Number, default: 0 }
    },
    lastDaily: { type: Number, default: 0 },
    dailyStreak: { type: Number, default: 0 },
    hasPlayed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
module.exports.STARTING_BALANCE = STARTING_BALANCE;