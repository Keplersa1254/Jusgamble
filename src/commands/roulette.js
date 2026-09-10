'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const RouletteGame = require('../../games/roulettegame');
const balanceManager = require('../../games/balance');
const userdata = require('../../games/userdata');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');

/** Maps user-friendly bet aliases to the canonical bet type used by the engine. */
const BET_ALIASES = {
    straight: 'straight',
    number: 'straight',
    red: 'red',
    black: 'black',
    green: 'green',
    even: 'even',
    odd: 'odd',
    '1-18': '1-18',
    '19-36': '19-36',
    '1-12': '1-12',
    '13-24': '13-24',
    '25-36': '25-36',
    'first-12': 'first-12',
    'second-12': 'second-12',
    'third-12': 'third-12',
    'first-dozen': 'first-dozen',
    'second-dozen': 'second-dozen',
    'third-dozen': 'third-dozen',
    'first-column': 'first-column',
    'second-column': 'second-column',
    'third-column': 'third-column'
};

const COLOR_EMOJIS = { red: '🔴', black: '⚫', green: '🟢' };

/** Shifting color strips — cycled each frame to simulate the wheel spinning. */
const SPIN_FRAMES = [
    '🔴 ⚫ 🟢 🔴 ⚫',
    '⚫ 🟢 🔴 ⚫ 🔴',
    '🟢 🔴 ⚫ 🔴 ⚫',
    '⚫ 🔴 🟢 ⚫ 🔴',
    '🔴 ⚫ 🔴 🟢 ⚫',
    '🟢 🔴 ⚫ 🟢 🔴'
];

/** Frame count and delay — ~2s total spin (fast + visible). */
const SPIN_FRAME_COUNT = 6;
const SPIN_FRAME_MS = 300;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely acknowledge the interaction once. Ignores 40060 (already acknowledged)
 * so a second bot process / double-fire never crashes the handler.
 */
async function safeDefer(interaction) {
    if (interaction.deferred || interaction.replied) return;
    try {
        await interaction.deferReply();
    } catch (err) {
        // 40060 = already acknowledged; 10062 = unknown/expired interaction
        if (err && (err.code === 40060 || err.code === 10062)) return;
        throw err;
    }
}

/**
 * Safely edit the deferred reply. Swallows rate-limit / already-acked errors
 * so the animation loop can keep going or fall through to the final result.
 * @returns {boolean} true if the edit succeeded
 */
async function safeEdit(interaction, payload) {
    try {
        await interaction.editReply(payload);
        return true;
    } catch (err) {
        const code = err && err.code;
        if (code === 40060 || code === 10062 || code === 429) {
            console.warn('Roulette edit skipped (code ' + code + '):', err.message || err);
            return false;
        }
        console.warn('Roulette edit failed:', err.message || err);
        return false;
    }
}

function buildSpinEmbed(frameIndex, betDisplay, amount) {
    const strip = SPIN_FRAMES[frameIndex % SPIN_FRAMES.length];
    return new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🎰 Roulette')
        .setDescription('🎰 Spinning the wheel...\n\n' + strip)
        .addFields(
            { name: 'Bet', value: betDisplay + ' • ' + formatCredits(amount), inline: true },
            { name: 'Status', value: 'Spinning…', inline: true }
        )
        .setFooter(footer('Spinning'));
}

function buildResultEmbed({ result, betDisplay, amount, won, payout, profit, newBalance }) {
    const colorEmoji = COLOR_EMOJIS[result.color] || '⚪';
    const colorName = result.color === 'green'
        ? 'Zero'
        : result.color[0].toUpperCase() + result.color.slice(1);
    const profitText = profit >= 0
        ? '+' + formatCredits(profit)
        : '−' + formatCredits(Math.abs(profit));

    return new EmbedBuilder()
        .setColor(won ? COLORS.SUCCESS : COLORS.NEUTRAL)
        .setTitle('🎰 Roulette')
        .setDescription(
            colorEmoji +
            ' Landed: `' + result.number + ' ' + colorName + '` │ Result: ' +
            (won ? 'WIN' : 'LOSS') +
            ' │ Profit: ' + profitText
        )
        .addFields(
            { name: 'Bet', value: betDisplay + ' • ' + formatCredits(amount), inline: true },
            { name: 'Payout', value: won ? '`' + payout + 'x`' : '`0x`', inline: true },
            { name: 'Balance', value: formatCredits(newBalance), inline: true }
        )
        .setFooter(footer('Roulette'));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roulette')
        .setDescription('Spin the roulette wheel and place a bet!')
        .addStringOption(option =>
            option.setName('bet')
                .setDescription('The type of bet (e.g. red, black, green, straight, even, odd, 1-18, 19-36, 1-12, etc.)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of credits to bet')
                .setRequired(true)
                .setMaxValue(MAX_BET))
        .addStringOption(option =>
            option.setName('value')
                .setDescription('The value for the bet (only for "straight" bets, a number 0-36)')
                .setRequired(false)),

    /**
     * Executes the roulette command with a visual wheel-spin animation.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        // Acknowledge once — never double-defer (fixes DiscordAPIError[40060]).
        await safeDefer(interaction);

        const betInput = interaction.options.getString('bet').toLowerCase();
        const valueInput = interaction.options.getString('value');
        const amount = interaction.options.getInteger('amount');
        if (amount > MAX_BET) {
            return safeEdit(interaction, { content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }

        if (amount <= 0) {
            return safeEdit(interaction, { content: 'Invalid bet — must be a positive amount.' });
        }

        const userId = interaction.user.id;
        const userBalance = await balanceManager.getBalance(userId);
        if (amount > userBalance) {
            return safeEdit(interaction, {
                content: `Your broke gng, you have ${userBalance} 🪙`
            });
        }

        const betType = BET_ALIASES[betInput];
        if (!betType) {
            const validBets = Object.keys(BET_ALIASES).join('`, `');
            return safeEdit(interaction, {
                content: 'Invalid bet type. Valid bets: `' + validBets + '`'
            });
        }

        let betValue = null;
        if (betType === 'straight') {
            if (!valueInput) {
                return safeEdit(interaction, {
                    content: 'Straight bet needs a number — use `value: 0-36`.'
                });
            }
            betValue = parseInt(valueInput, 10);
            if (Number.isNaN(betValue) || betValue < 0 || betValue > 36) {
                return safeEdit(interaction, {
                    content: 'Invalid number — for a straight bet, `value` must be between 0 and 36.'
                });
            }
        }

        const betDisplay = betValue !== null
            ? '`' + betType + '` • `' + betValue + '`'
            : '`' + betType + '`';

        // Generate the result up front — animation is cosmetic only.
        const game = new RouletteGame();
        const result = game.spin();
        const resolution = game.resolveBet(betType, betValue);

        // Deduct the bet immediately so concurrent commands see the lower balance.
        await balanceManager.updateBalance(userId, userBalance - amount);
        // Fast spin animation: 6 frames × 300ms ≈ 1.8s total.
        for (let i = 0; i < SPIN_FRAME_COUNT; i++) {
            await safeEdit(interaction, {
                content: '',
                embeds: [buildSpinEmbed(i, betDisplay, amount)]
            });
            if (i < SPIN_FRAME_COUNT - 1) {
                await sleep(SPIN_FRAME_MS);
            }
        }

        // Settle the bet.  The engine PAYOUTS are profit multipliers
        // (red = 1x = even-money, straight = 35x, etc.).  On a win the
        // player keeps their original bet AND earns the profit on top.
        const won = resolution.win;
        const payout = resolution.payout;
        const profit = won ? amount * payout : -amount;

        let newBalance;
        if (won) {
            const current = await balanceManager.getBalance(userId);
            const credit = amount + amount * payout;
            const br = await balanceManager.updateBalance(userId, current + credit);
            newBalance = br.balance;
        } else {
            newBalance = userBalance - amount;
        }

        const finalEmbed = buildResultEmbed({
            result,
            betDisplay,
            amount,
            won,
            payout,
            profit,
            newBalance
        });

        let content = '';
        if (won && result.color === 'green') {
            content = 'Green pocket — pays 17:1.';
        }

        await safeEdit(interaction, { content, embeds: [finalEmbed] });

        // Track outcome in the JSON userdata store (best-effort).
        try { await userdata.recordGameResult(userId, 'roulette', won ? 'win' : 'loss', amount); } catch (_) {}
    }
};
