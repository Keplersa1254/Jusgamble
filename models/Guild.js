'use strict';

const mongoose = require('mongoose');

/**
 * A single purchasable role in a server's role shop.
 */
const shopRoleSchema = new mongoose.Schema({
    roleId: { type: String, required: true },
    price: { type: Number, required: true, min: 1 },
    description: { type: String, default: 'No description provided.' },
    isActive: { type: Boolean, default: true }
}, { _id: false });

/**
 * Server-level configuration for the economy bot.
 */
const guildSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    shopRoles: { type: [shopRoleSchema], default: [] },
    // Channels where the bot's commands are permitted. Empty = all channels.
    allowedChannels: { type: [String], default: [] }
}, { timestamps: true });

/**
 * Returns the guild config as a plain object, auto-creating it if missing.
 * @param {string} guildId
 * @returns {Promise<Object>}
 */
guildSchema.statics.findOrCreate = async function (guildId) {
    const existing = await this.findOne({ guildId }).lean();
    if (existing) return existing;
    const created = await this.create({ guildId, shopRoles: [], allowedChannels: [] });
    return created.toObject();
};

module.exports = mongoose.model('Guild', guildSchema);
