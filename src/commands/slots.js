'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const userdata = require('../../games/userdata');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');
const { randomInt } = require('crypto');

// ── Slots reel definitions ────────────────────────────────────────────

var SYMBOLS = [
    { emoji: '💎', name: 'Diamond'    },
    { emoji: '🔔', name: 'Bell'       },
    { emoji: '🍇', name: 'Grapes'     },
    { emoji: '🍋', name: 'Lemon'      },
    { emoji: '🍒', name: 'Cherry'     },
    { emoji: '🍉', name: 'Watermelon' },
    { emoji: '7️⃣', name: 'Seven'      }
];

/**
 * Payout table keyed by [name]: { 3: multiplier, 2: multiplier_or_0 }.
 * Lookup is by symbol name because 2-of-a-kind applies to the *pair*.
 */
// Simple payout tiers: Jackpot (3x 💎), 3-of-a-kind, 2-of-a-kind, or bust.
var JACKPOT_PAYOUT  = 10;
var THREE_OAK_PAYOUT = 3;
var TWO_OAK_PAYOUT   = 1.5;


// ── Helpers ───────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
}

/**
 * Roll one reel — returns an index into SYMBOLS (0-4).
 */
function roll() {
    return randomInt(0, SYMBOLS.length);
}

/**
 * Computes the multiplier for a 3-reel result.
 * @param {number[]} reels — array of 3 symbol indices
 * @returns {{payout: number, name: string}}
 */
function evaluate(reels) {
    var r0 = reels[0], r1 = reels[1], r2 = reels[2];

    // 3-of-a-kind
    if (r0 === r1 && r1 === r2) {
        // Jackpot: all three are the 💎 Diamond
        return {
            payout: SYMBOLS[r0].name === 'Diamond' ? JACKPOT_PAYOUT : THREE_OAK_PAYOUT,
            name:   SYMBOLS[r0].name === 'Diamond' ? 'JACKPOT! 💎💎💎' : '3x ' + SYMBOLS[r0].name
        };
    }

    // 2-of-a-kind (any pair)
    if (r0 === r1 || r0 === r2 || r1 === r2) {
        var pairSym = r0 === r1 ? SYMBOLS[r0] : (r0 === r2 ? SYMBOLS[r0] : SYMBOLS[r1]);
        return { payout: TWO_OAK_PAYOUT, name: '2x ' + pairSym.name };
    }

    // All three different
    return { payout: 0, name: 'No match' };
}

// ── Embed builders ────────────────────────────────────────────────────

function formatReelLine(reels) {
    return '| ' + reels.map(function(i) { return SYMBOLS[i].emoji; }).join(' | ') + ' |';
}

function buildSpinEmbed(reels, mask) {
    if (!mask) mask = [false, false, false];
    var parts = [];
    for (var i = 0; i < 3; i++) {
        parts.push(mask[i] ? SYMBOLS[reels[i]].emoji : '🎰');
    }
    var line = '| ' + parts.join(' | ') + ' |';
    return new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🎰 Jusgamble Slots')
        .setDescription('Spinning the reels...\n\n' + line)
        .setFooter(footer('Slots'));
}

function buildResultEmbed(reels, bet, evalResult, newBalance) {
    var won = evalResult.payout > 0;
    var color = won ? COLORS.SUCCESS : COLORS.ERROR;
    var winnings = Math.floor(bet * evalResult.payout);
    var profit = won ? winnings : -bet;

    var desc = formatReelLine(reels) + '\n\n';
    if (won) {
        desc += '🎉 You won ' + formatCredits(winnings) + '! (Multiplier: `' + evalResult.payout.toFixed(1) + 'x`)';
    } else {
        desc += '❌ You lost ' + formatCredits(bet) + '. Better luck next time!';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setTitle('🎰 Jusgamble Slots')
        .setDescription(desc)
        .addFields(
            { name: 'Combo', value: evalResult.name, inline: true },
            { name: 'Bet', value: formatCredits(bet), inline: true },
            { name: 'Profit', value: (profit >= 0 ? '+' : '') + formatCredits(profit), inline: true },
            { name: 'Balance', value: formatCredits(newBalance), inline: true }
        )
        .setFooter(footer('Slots'));
}

// ── Command ───────────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Spin the slot machine!')
        .addIntegerOption(function(opt) {
            return opt.setName('bet')
                .setDescription('Amount of credits to bet (min 10)')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET);
        }),

    async execute(interaction) {
        await interaction.deferReply();

        var bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }
        if (bet < 10) {
            return interaction.editReply({ content: '❌ Minimum bet is 10 🪙.' });
        }

        var userId = interaction.user.id;
        var userBalance = await balanceManager.getBalance(userId);
        if (bet > userBalance) {
            return interaction.editReply({ content: '❌ Your broke gng, you have ' + formatCredits(userBalance) + '.' });
        }

        // Deduct bet immediately
        await balanceManager.updateBalance(userId, userBalance - bet);

        // Pre-roll the outcome (fair RNG — animation is cosmetic)
        var finalReels = [roll(), roll(), roll()];
        var evalResult = evaluate(finalReels);
        var won = evalResult.payout > 0;

        // ── Sequential spin animation (350ms per step) ─────────────
        // Reels lock from left to right: all spinning → 1st locks → 2nd → 3rd
        var SPIN_STEP_MS = 350;

        // Frame 0: all three spinning
        var spinningReels = [roll(), roll(), roll()];
        try { await interaction.editReply({ embeds: [buildSpinEmbed(spinningReels, [false, false, false])] }); } catch (_) {}
        await sleep(SPIN_STEP_MS);

        // Frame 1: 1st reel locked, 2-3 still spinning
        var step1 = [roll(), roll()];
        try { await interaction.editReply({ embeds: [buildSpinEmbed(finalReels, [true, false, false])] }); } catch (_) {}
        await sleep(SPIN_STEP_MS);

        // Frame 2: 1st+2nd locked, 3rd still spinning
        try { await interaction.editReply({ embeds: [buildSpinEmbed(finalReels, [true, true, false])] }); } catch (_) {}
        await sleep(SPIN_STEP_MS);

        // Frame 3: all three locked — the actual result
        try { await interaction.editReply({ embeds: [buildSpinEmbed(finalReels, [true, true, true])] }); } catch (_) {}

        // ── Payout ────────────────────────────────────────────────
        var newBalance;
        if (won) {
            var winnings = Math.floor(bet * evalResult.payout);
            var current = await balanceManager.getBalance(userId);
            var br = await balanceManager.updateBalance(userId, current + winnings);
            newBalance = br.balance;
        } else {
            newBalance = userBalance - bet;
        }

        var resultEmbed = buildResultEmbed(finalReels, bet, evalResult, newBalance);
        try {
            await interaction.editReply({ embeds: [resultEmbed] });
        } catch (_) {}

        // Track outcome in the JSON userdata store (best-effort).
        try { await userdata.recordGameResult(userId, 'slots', won ? 'win' : 'loss', bet); } catch (_) {}
    },

    balanceManager: balanceManager
};
