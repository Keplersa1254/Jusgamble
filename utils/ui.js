'use strict';

/**
 * Shared UI helpers for all casino commands.
 * Centralizes the cohesive color palette, credit formatting, and footer
 * styling so every command renders a consistent, modern look.
 *
 * Palette: Dark Gold (panels), Emerald Green (wins), Crimson Red (losses),
 *           Cool Grey (draws/pushes).
 */

const COLORS = {
    /** Standard / neutral embeds — dark gold */
    NEUTRAL: 0xE5A93C,
    /** Wins / positive outcomes — emerald green */
    SUCCESS: 0x2ECC71,
    /** Losses / negative outcomes — crimson red */
    ERROR:   0xE74C3C,
    /** Draws / pushes — cool grey */
    DRAW:    0x95A5A6
};

/** Maximum credits a player may wager in a single game bet. */
const MAX_BET = 100000;

/**
 * Formats a number with thousands separators and a single coin emoji.
 * @param {number|string} value
 * @returns {string} e.g. "12,500 🪙"
 */
function formatCredits(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return value + ' 🪙';
    return n.toLocaleString('en-US') + ' 🪙';
}

/**
 * Formats a hand as inline-code cards joined by spaces.
 * @param {string[]} hand
 * @returns {string} e.g. "\`A♠\` \`10♥\`"
 */
function formatHand(hand) {
    return hand.map(card => '\`' + card + '\`').join(' ');
}

/**
 * Builds a consistent footer: "Jusgamble • Today at HH:MM".
 * @param {string}  label  Status text shown on the left.
 * @param {Date}    [date] Timestamp; defaults to now.
 * @returns {{ text: string }}
 */
function footer(label, date) {
    date = date || new Date();
    var hh = String(date.getHours()).padStart(2, '0');
    var mm = String(date.getMinutes()).padStart(2, '0');
    return { text: 'Jusgamble • Today at ' + hh + ':' + mm };
}

module.exports = { COLORS: COLORS, MAX_BET: MAX_BET, formatCredits: formatCredits, formatHand: formatHand, footer: footer };
