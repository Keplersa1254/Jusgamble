'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const balanceManager = require('../../games/balance');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');
const { randomInt } = require('crypto');

/**
 * Fisher-Yates shuffle for the 6-chamber cylinder.
 * @param {Array} arr
 */
function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = randomInt(0, i + 1);
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}

/** Chamber count and multiplier progression. */
var CHAMBERS = 6;
var MULTIPLIERS = [0.50, 1.00, 1.50, 2.00, 2.50];
var INACTIVITY_MS = 30000;

/** In-memory sessions keyed by message id. */
var sessions = new Map();

/**
 * Builds the action row with Pull Trigger and Cash Out buttons.
 * @param {string} gameId
 * @param {number} currentMultiplier
 * @param {number} bet
 */
function buildButtons(gameId, currentMultiplier, bet) {
    var cashoutLabel = 'Cash Out (\ud83d\udcb0 ' + Math.floor(bet * currentMultiplier) + ')';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('rr_pull:' + gameId)
            .setLabel('Pull Trigger')
            .setEmoji('\ud83d\udd2b')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('rr_cashout:' + gameId)
            .setLabel(cashoutLabel)
            .setEmoji('\ud83d\udcb0')
            .setStyle(ButtonStyle.Success)
    );
}

/**
 * Builds the game embed.
 */
function buildEmbed(userName, bet, multiplier, pulls, chambersLeft, status) {
    var cashout = Math.floor(bet * multiplier);
    var desc = '';
    var color = COLORS.NEUTRAL;

    if (status === 'lost') {
        color = COLORS.ERROR;
        desc = '\ud83d\udca5 **BANG!** The bullet was chambered!\nYou lost ' + formatCredits(bet) + '.';
    } else if (status === 'cashed_out') {
        color = COLORS.SUCCESS;
        desc = '\ud83d\udcb0 Cashed out **' + formatCredits(cashout) + '**\nMultiplier: `' + multiplier.toFixed(2) + 'x`';
    } else if (status === 'won') {
        // Survived all 5 pulls
        color = COLORS.SUCCESS;
        desc = '\ud83c\udfc6 Survived all 5 pulls!\nPayout: **' + formatCredits(cashout) + '** at `' + multiplier.toFixed(2) + 'x`';
    } else if (status === 'expired') {
        color = COLORS.ERROR;
        desc = '\u23f0 Time ran out — you forfeited ' + formatCredits(bet) + '.';
    } else {
        desc = 'Pull the trigger or cash out — but one chamber has the bullet!';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setTitle('Russian Roulette')
        .setDescription(desc)
        .addFields(
            { name: 'Bet', value: formatCredits(bet), inline: true },
            { name: 'Multiplier', value: '`' + multiplier.toFixed(2) + 'x`', inline: true },
            { name: 'Cashout', value: formatCredits(cashout), inline: true },
            { name: 'Pulls', value: pulls + ' / 5', inline: true },
            { name: 'Chambers', value: chambersLeft + ' / ' + CHAMBERS, inline: true }
        )
        .setFooter(footer('Russian Roulette'));
}

/** Sleep helper. */
function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('russian-roulette')
        .setDescription('Play Russian Roulette — pull the trigger, dodge the bullet, cash out!')
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
            return interaction.editReply({ content: '\u274c Minimum bet is 10 \U0001FA99.' });
        }

        var userId = interaction.user.id;
        var userName = interaction.user.username;

        // Balance check
        var bal = await balanceManager.getBalance(userId);
        if (bet > bal) {
            return interaction.editReply({ content: '\u274c Yetersiz bakiye! You have ' + formatCredits(bal) + '.' });
        }

        // Deduct bet immediately
        await balanceManager.updateBalance(userId, bal - bet);

        // Build the cylinder: 1 bullet (true), 5 blanks (false)
        var chambers = [true, false, false, false, false, false];
        shuffle(chambers);

        var gameId = '' + Date.now() + '_' + randomInt(0, 1000000);
        var session = {
            userId: userId,
            userName: userName,
            bet: bet,
            chambers: chambers,
            currentIndex: 0,       // next chamber to fire
            pulls: 0,              // successful pulls so far
            multiplier: MULTIPLIERS[0],
            alive: true,
            channelId: interaction.channelId,
            timeoutId: null
        };

        sessions.set(gameId, session);

        // 30s inactivity timeout
        function startTimeout() {
            if (session.timeoutId) clearTimeout(session.timeoutId);
            session.timeoutId = setTimeout(async function() {
                var s = sessions.get(gameId);
                if (!s || !s.alive) return;
                s.alive = false;
                sessions.delete(gameId);
                try {
                    var disableRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('rr_exp').setLabel('Time Expired').setEmoji('\u23f0').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                    var emb = buildEmbed(s.userName, s.bet, s.multiplier, s.pulls, CHAMBERS - s.currentIndex, 'expired');
                    await interaction.editReply({ content: null, embeds: [emb], components: [disableRow] });
                } catch (_) {}
            }, INACTIVITY_MS);
        }

        startTimeout();

        var embed = buildEmbed(userName, bet, MULTIPLIERS[0], 0, CHAMBERS, 'playing');
        var row = buildButtons(gameId, MULTIPLIERS[0], bet);

        await interaction.editReply({ content: null, embeds: [embed], components: [row] });
    },

    /**
     * Global button handler for Russian Roulette interactions.
     */
    registerButtonHandler(client) {
        client.on('interactionCreate', async function(interaction) {
            if (!interaction.isButton()) return;
            var cid = interaction.customId;
            if (!cid.startsWith('rr_pull:') && !cid.startsWith('rr_cashout:')) return;

            var parts = cid.split(':');
            var gameId = parts[1];
            var action = cid.startsWith('rr_pull:') ? 'pull' : 'cashout';

            var session = sessions.get(gameId);
            if (!session || !session.alive) {
                return interaction.reply({ content: 'This game is no longer active.', ephemeral: true });
            }

            // Only the player who started the game can interact
            if (interaction.user.id !== session.userId) {
                return interaction.reply({ content: 'This is not your game!', ephemeral: true });
            }

            await interaction.deferUpdate();

            // Reset inactivity timer
            if (session.timeoutId) clearTimeout(session.timeoutId);

            if (action === 'cashout') {
                // ── CASH OUT ──────────────────────────────────
                session.alive = false;
                sessions.delete(gameId);
                if (session.timeoutId) clearTimeout(session.timeoutId);

                var payout = Math.floor(session.bet * session.multiplier);
                var currentBal = await balanceManager.getBalance(session.userId);
                await balanceManager.updateBalance(session.userId, currentBal + payout);

                var emb = buildEmbed(session.userName, session.bet, session.multiplier, session.pulls, CHAMBERS - session.currentIndex, 'cashed_out');
                var disableRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rr_done').setLabel('Cashed Out').setEmoji('\ud83d\udcb0').setStyle(ButtonStyle.Success).setDisabled(true)
                );
                try {
                    await interaction.editReply({ content: null, embeds: [emb], components: [disableRow] });
                } catch (_) {}
                return;
            }

            // ── PULL TRIGGER ─────────────────────────────────
            var chamber = session.chambers[session.currentIndex];
            session.currentIndex++;

            if (chamber) {
                // BANG — bullet fired
                session.alive = false;
                sessions.delete(gameId);
                if (session.timeoutId) clearTimeout(session.timeoutId);

                var emb = buildEmbed(session.userName, session.bet, session.multiplier, session.pulls, CHAMBERS - session.currentIndex, 'lost');
                var disableRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rr_lost').setLabel('BANG!').setEmoji('\ud83d\udca5').setStyle(ButtonStyle.Danger).setDisabled(true)
                );
                try {
                    await interaction.editReply({ content: null, embeds: [emb], components: [disableRow] });
                } catch (_) {}
                return;
            }

            // CLICK — blank. Advance multiplier.
            session.pulls++;

            if (session.pulls >= 5) {
                // Survived all 5 — auto-cashout at max multiplier
                session.alive = false;
                sessions.delete(gameId);
                if (session.timeoutId) clearTimeout(session.timeoutId);

                session.multiplier = MULTIPLIERS[session.pulls - 1];
                var payout = Math.floor(session.bet * session.multiplier);
                var bal = await balanceManager.getBalance(session.userId);
                await balanceManager.updateBalance(session.userId, bal + payout);

                var emb = buildEmbed(session.userName, session.bet, session.multiplier, session.pulls, CHAMBERS - session.currentIndex, 'won');
                var winRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rr_won').setLabel('Victory!').setEmoji('\ud83c\udfc6').setStyle(ButtonStyle.Success).setDisabled(true)
                );
                try {
                    await interaction.editReply({ content: null, embeds: [emb], components: [winRow] });
                } catch (_) {}
                return;
            }

            // Still alive — advance multiplier and re-display
            session.multiplier = MULTIPLIERS[session.pulls];
            var newEmb = buildEmbed(session.userName, session.bet, session.multiplier, session.pulls, CHAMBERS - session.currentIndex, 'playing');
            var newRow = buildButtons(gameId, session.multiplier, session.bet);

            // Re-arm the timeout
            if (session.timeoutId) clearTimeout(session.timeoutId);
            session.timeoutId = setTimeout(async function() {
                var s = sessions.get(gameId);
                if (!s || !s.alive) return;
                s.alive = false;
                sessions.delete(gameId);
                try {
                    var dr = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('rr_exp').setLabel('Time Expired').setEmoji('\u23f0').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                    var eb = buildEmbed(s.userName, s.bet, s.multiplier, s.pulls, CHAMBERS - s.currentIndex, 'expired');
                    await interaction.editReply({ content: null, embeds: [eb], components: [dr] });
                } catch (_) {}
            }, INACTIVITY_MS);

            try {
                await interaction.editReply({ content: null, embeds: [newEmb], components: [newRow] });
            } catch (_) {}
        });
    },

    balanceManager: balanceManager
};
