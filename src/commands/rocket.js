'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { randomUUID } = require('crypto');
const balanceManager = require('../../games/balance');
const userdata = require('../../games/userdata');
const { MAX_BET, formatCredits, footer } = require('../../utils/ui');

const COLOR_PLAYING = 0x8A2BE2; // Purple
const COLOR_WIN     = 0x2ECC71; // Green
const COLOR_LOSS    = 0xE74C3C; // Red

const TICK_MS = 700;   // delay between multiplier climbs
const STEP    = 0.12;  // multiplier increase per tick
const MAX_MULT = 100;  // theoretical ceiling

const games = new Map();

/**
 * Picks the crash point using a weighted-bracket system tuned for a ~5% house
 * edge. Low cashouts are punished so players can't farm small safe wins:
 *   -  4%  → instant crash at exactly 1.00x
 *   - 35%  → 1.01x – 1.50x
 *   - 40%  → 1.51x – 3.00x
 *   - 13%  → 3.01x – 9.99x
 *   -  8%  → 10.00x – MAX_MULT (heavy-tailed toward the low end)
 * @returns {number}
 */
function generateCrashPoint() {
    const roll = Math.random();

    if (roll < 0.04) {
        // Instant crash.
        return 1.00;
    }
    if (roll < 0.39) {
        // Low multiplier: 1.01x – 1.50x (35%).
        return roundMult(1.01 + Math.random() * 0.49);
    }
    if (roll < 0.79) {
        // Mid multiplier: 1.51x – 3.00x (40%).
        return roundMult(1.51 + Math.random() * 1.49);
    }
    if (roll < 0.92) {
        // High multiplier: 3.01x – 9.99x (13%).
        return roundMult(3.01 + Math.random() * 6.98);
    }
    // Extreme multiplier: 10.00x – MAX_MULT (8%), biased low.
    return roundMult(Math.min(MAX_MULT, 10 / (1 - 0.9 * Math.random())));
}

function roundMult(m) {
    return Math.round(m * 100) / 100;
}

function buildEmbed(session) {
    const cashout = Math.floor(session.bet * session.multiplier);
    return new EmbedBuilder()
        .setColor(COLOR_PLAYING)
        .setTitle('🚀 Crash')
        .setDescription(
            'Multiplier: **' + session.multiplier.toFixed(2) + 'x**\n' +
            'Cash Out: **' + formatCredits(cashout) + '**'
        )
        .addFields(
            { name: 'Bet', value: formatCredits(session.bet), inline: true },
            { name: 'Status', value: 'Flying...', inline: true }
        )
        .setFooter(footer('Crash'));
}

function buildButtons(gameId, multiplier) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('rocket_cashout:' + gameId)
            .setLabel('Cash Out (' + multiplier.toFixed(2) + 'x)')
            .setEmoji('💵')
            .setStyle(ButtonStyle.Success)
    )];
}

function buildFinalEmbed(session, status, payoutBalance) {
    const crashed = status === 'crashed';
    const cashout = crashed ? 0 : Math.floor(session.bet * session.multiplier);
    const profit = cashout - session.bet;
    return new EmbedBuilder()
        .setColor(crashed ? COLOR_LOSS : COLOR_WIN)
        .setTitle(crashed ? '💥 Crashed' : '💰 Cashed Out')
        .setDescription(
            'Multiplier: **' + session.multiplier.toFixed(2) + 'x**\n' +
            (crashed
                ? 'The rocket crashed before you cashed out!'
                : 'Payout: **' + formatCredits(cashout) + '** (' + (profit >= 0 ? '+' : '') + formatCredits(profit) + ')')
        )
        .addFields(
            { name: 'Bet', value: formatCredits(session.bet), inline: true },
            { name: 'Result', value: crashed ? 'LOSS' : 'WIN', inline: true },
            { name: 'Balance', value: formatCredits(payoutBalance), inline: true }
        )
        .setFooter(footer('Crash'));
}

async function crash(gameId) {
    const session = games.get(gameId);
    if (!session || session.status !== 'playing') return;
    session.status = 'crashed';
    if (session.timer) clearTimeout(session.timer);
    games.delete(gameId);

    const balance = await balanceManager.getBalance(session.userId);

    try {
        await session.interaction.editReply({
            embeds: [buildFinalEmbed(session, 'crashed', balance)],
            components: []
        });
    } catch (_) { /* interaction expired — bet already lost */ }

    try { await userdata.recordGameResult(session.userId, 'rocket', 'loss', session.bet); } catch (_) {}
}

async function cashOut(gameId) {
    const session = games.get(gameId);
    if (!session || session.status !== 'playing') return null;
    session.status = 'cashed_out';
    if (session.timer) clearTimeout(session.timer);
    games.delete(gameId);

    const multiplier = session.multiplier;
    const payout = Math.floor(session.bet * multiplier);
    const current = await balanceManager.getBalance(session.userId);
    const result = await balanceManager.updateBalance(session.userId, current + payout);

    try { await userdata.recordGameResult(session.userId, 'rocket', 'win', session.bet); } catch (_) {}

    return { payout, balance: result.balance, multiplier };
}

async function tick(gameId) {
    const session = games.get(gameId);
    if (!session || session.status !== 'playing') return;

    session.multiplier = roundMult(session.multiplier + STEP);

    if (session.multiplier >= session.crashPoint) {
        // Clamp to the true crash point so the display isn't overshot.
        session.multiplier = session.crashPoint;
        await crash(gameId);
        return;
    }

    try {
        await session.interaction.editReply({
            embeds: [buildEmbed(session)],
            components: buildButtons(gameId, session.multiplier)
        });
    } catch (_) {
        return;
    }

    session.timer = setTimeout(() => tick(gameId), TICK_MS);
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('rocket')
        .setDescription('Play Crash — cash out before the rocket explodes!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount of credits to bet')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET)),

    async execute(interaction) {
        await interaction.deferReply();

        const bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }
        const userId = interaction.user.id;

        if (bet < 10) {
            return interaction.editReply({ content: '❌ Minimum bet is 10 🪙.' });
        }

        const userBalance = await balanceManager.getBalance(userId);
        if (bet > userBalance) {
            return interaction.editReply({ content: '❌ Your broke gng, you have ' + formatCredits(userBalance) + '.' });
        }

        await balanceManager.updateBalance(userId, userBalance - bet);

        const gameId = randomUUID();
        const session = {
            userId,
            bet,
            multiplier: 0.50,
            crashPoint: generateCrashPoint(),
            status: 'playing',
            gameId,
            interaction,
            timer: null
        };
        games.set(gameId, session);

        await interaction.editReply({
            embeds: [buildEmbed(session)],
            components: buildButtons(gameId, 0.50)
        });

        session.timer = setTimeout(() => tick(gameId), TICK_MS);
    },

    registerButtonHandler(client) {
        client.on('interactionCreate', async interaction => {
            if (!interaction.isButton()) return;
            if (!interaction.customId.startsWith('rocket_cashout:')) return;

            try {
                await interaction.deferUpdate();

                const gameId = interaction.customId.slice('rocket_cashout:'.length);
                const session = games.get(gameId);

                if (!session) {
                    return interaction.followUp({ content: 'This game is already over.', flags: MessageFlags.Ephemeral });
                }
                if (interaction.user.id !== session.userId) {
                    return interaction.followUp({ content: 'This is not your game.', flags: MessageFlags.Ephemeral });
                }
                if (session.status !== 'playing') {
                    return interaction.followUp({ content: 'This game is already over.', flags: MessageFlags.Ephemeral });
                }

                const result = await cashOut(gameId);
                if (!result) {
                    return interaction.followUp({ content: 'This game is already over.', flags: MessageFlags.Ephemeral });
                }

                await interaction.editReply({
                    embeds: [buildFinalEmbed(session, 'cashed_out', result.balance)],
                    components: []
                });
            } catch (err) {
                const code = err && (err.code ?? err.httpStatus);
                const transient = code === 10062 || code === 'ECONNRESET' || code === 'ETIMEDOUT' || (typeof code === 'number' && code >= 500 && code < 600);
                if (transient) {
                    console.warn('rocket button: transient Discord error (code:', code, ') — ignored.');
                    return;
                }
                console.error('rocket button error:', err.message || err);
                try {
                    await interaction.followUp({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
                } catch (_) { /* interaction closed */ }
            }
        });
    },

    get games() { return games; },
    balanceManager,
    generateCrashPoint
};

