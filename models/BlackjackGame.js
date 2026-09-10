'use strict';

const mongoose = require('mongoose');

const GAME_TTL_MS = 30 * 60 * 1000; // 30 minutes

const blackjackGameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    channelId: String,
    bet: { type: Number, default: 0 },
    deck: { type: [String], default: [] },
    playerHand: { type: [String], default: [] },
    dealerHand: { type: [String], default: [] },
    playerStood: { type: Boolean, default: false },
    gameOver: { type: Boolean, default: false },
    outcome: { type: String, default: null },
    savedAt: { type: Date, default: Date.now }
});

// TTL index: auto-remove documents 30 minutes after savedAt.
blackjackGameSchema.index({ savedAt: 1 }, { expireAfterSeconds: Math.floor(GAME_TTL_MS / 1000) });

module.exports = mongoose.model('BlackjackGame', blackjackGameSchema);
module.exports.GAME_TTL_MS = GAME_TTL_MS;