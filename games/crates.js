'use strict';

/**
 * Crate system configuration & helpers.
 *
 * Rarity drop probabilities (used by /daily) and reward ranges (used by
 * /crate) live here so /daily, /crate, /inventory and /crateinfo all read
 * the same source of truth.
 */

const { randomInt } = require('crypto');

// Display order (most common → most rare).
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

const RARITIES = {
    common:    { label: 'Common',    emoji: '⬜', color: 0x95A5A6, dropRate: 0.40, min: 299,   max: 999 },
    uncommon:  { label: 'Uncommon',  emoji: '🟩', color: 0x2ECC71, dropRate: 0.35, min: 500,   max: 1299 },
    rare:      { label: 'Rare',      emoji: '🟦', color: 0x3498DB, dropRate: 0.15, min: 1299,  max: 3999 },
    epic:      { label: 'Epic',      emoji: '🟪', color: 0x9B59B6, dropRate: 0.06, min: 3999,  max: 10000 },
    legendary: { label: 'Legendary', emoji: '🟧', color: 0xE67E22, dropRate: 0.03, min: 10000, max: 15000 },
    mythic:    { label: 'Mythic',    emoji: '🟥', color: 0xE74C3C, dropRate: 0.01, min: 15000, max: 30000 }
};

/**
 * Rolls a crate rarity using the configured drop probabilities.
 * @returns {string} rarity key (one of RARITY_ORDER)
 */
function rollCrateRarity() {
    let roll = Math.random();
    for (const key of RARITY_ORDER) {
        const drop = RARITIES[key].dropRate;
        if (roll < drop) return key;
        roll -= drop;
    }
    return RARITY_ORDER[0]; // floating-point safety net
}

/**
 * Returns the rarity metadata for a key, or null if unknown.
 * @param {string} key
 * @returns {Object|null}
 */
function getRarity(key) {
    return RARITIES[key] || null;
}

/**
 * Rolls a random whole-number reward within a rarity's range (inclusive).
 * @param {string} rarity
 * @returns {number}
 */
function randomReward(rarity) {
    const r = RARITIES[rarity];
    if (!r) throw new Error('Unknown crate rarity: ' + rarity);
    return randomInt(r.min, r.max + 1);
}

/**
 * Formats a drop rate (0..1) as a percentage string, e.g. "40%".
 * @param {string} rarity
 * @returns {string}
 */
function formatDropRate(rarity) {
    const r = RARITIES[rarity];
    return Math.round(r.dropRate * 100) + '%';
}

module.exports = {
    RARITY_ORDER: RARITY_ORDER,
    RARITIES: RARITIES,
    rollCrateRarity: rollCrateRarity,
    getRarity: getRarity,
    randomReward: randomReward,
    formatDropRate: formatDropRate
};
