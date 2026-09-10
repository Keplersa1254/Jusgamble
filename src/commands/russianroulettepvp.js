'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const balanceManager = require('../../games/balance');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');
const { randomInt } = require('crypto');

/** Accept-challenge timeout (ms). */
var ACCEPT_TIMEOUT_MS = 120000;
/** Per-turn inactivity timeout (ms). */
var TURN_TIMEOUT_MS   = 30000;
/** Total chambers. */
var CHAMBERS          = 6;

/** Pending challenges keyed by message id. */
var challenges = new Map();
/** Active duels keyed by message id. */
var duels = new Map();

/** Sleep helper. */
function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
}

/**
 * Build the challenge embed (before acceptance).
 */
function buildChallengeEmbed(hostId, bet, pot) {
    return new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🔫 Russian Roulette Duel')
        .setDescription('<@' + hostId + '> put up **' + formatCredits(bet) + '** for a Russian Roulette duel! Who will accept?')
        .addFields(
            { name: 'Wager', value: formatCredits(bet), inline: true },
            { name: 'Winner Pot', value: formatCredits(pot), inline: true },
            { name: 'Expires', value: '120 seconds', inline: true }
        )
        .setFooter(footer('Waiting for challenger'));
}

/**
 * Build the in-progress duel embed.
 */
function buildDuelEmbed(currentPlayerId, otherPlayerId, chambersLeft, pot) {
    var odds = chambersLeft > 0 ? '1/' + chambersLeft : '0';
    return new EmbedBuilder()
        .setColor(COLORS.NEUTRAL)
        .setTitle('🔫 Russian Roulette Duel')
        .setDescription('<@' + currentPlayerId + '> turn — pull the trigger or the next chamber could be the bullet!')
        .addFields(
            { name: '👤 Current Turn', value: '<@' + currentPlayerId + '>', inline: true },
            { name: '📦 Chambers Left', value: chambersLeft + ' / ' + CHAMBERS, inline: true },
            { name: '☠ Death Odds', value: odds, inline: true },
            { name: '🪙 Pot', value: formatCredits(pot), inline: true }
        )
        .setFooter(footer('Russian Roulette Duel'));
}

/**
 * Build the pull-trigger button (only for the current player).
 */
function buildPullButton(gameId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('rrpvp_pull:' + gameId)
            .setLabel('Pull Trigger')
            .setEmoji('🔫')
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('russian-roulette-pvp')
        .setDescription('Challenge another player to a Russian Roulette duel!')
        .addIntegerOption(function(opt) {
            return opt.setName('bet')
                .setDescription('Amount of credits to wager (min 10)')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET);
        }),

    /**
     * Host starts a challenge.
     */
    async execute(interaction) {
        await interaction.deferReply();

        var bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }
        if (bet < 10) {
            return interaction.editReply({ content: '❌ Minimum bet is 10 🪙.' });
        }

        var hostId = interaction.user.id;
        var hostName = interaction.user.username;

        var hostBal = await balanceManager.getBalance(hostId);
        if (bet > hostBal) {
            return interaction.editReply({ content: '❌ your broke gng, You have ' + formatCredits(hostBal) + '.' });
        }

        // Deduct host bet immediately
        await balanceManager.updateBalance(hostId, hostBal - bet);

        var pot = bet * 2;
        var emb = buildChallengeEmbed(hostId, bet, pot);
        var acceptBtn = new ButtonBuilder()
            .setCustomId('rrpvp_accept')
            .setLabel('Accept Duel')
            .setEmoji('🔫')
            .setStyle(ButtonStyle.Success);
        var row = new ActionRowBuilder().addComponents(acceptBtn);

        var msg = await interaction.editReply({
            content: '<@' + hostId + '> started a Russian Roulette duel!',
            embeds: [emb],
            components: [row]
        });

        var challengeId = msg.id;
        challenges.set(challengeId, {
            hostId: hostId,
            hostName: hostName,
            bet: bet,
            accepted: false
        });

        // 120s accept timeout
        setTimeout(async function() {
            var c = challenges.get(challengeId);
            if (!c || c.accepted) return;
            challenges.delete(challengeId);

            // Refund host
            var cur = await balanceManager.getBalance(hostId);
            await balanceManager.updateBalance(hostId, cur + bet);

            try {
                var expRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rrpvp_exp').setLabel('Challenge Expired').setEmoji('⏰').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                var expEmb = new EmbedBuilder()
                    .setColor(COLORS.ERROR)
                    .setTitle('🔫 Russian Roulette Duel — Expired')
                    .setDescription('<@' + hostId + '> bet of **' + formatCredits(bet) + '** refunded.')
                    .setFooter(footer('Timeout'));
                await msg.edit({ content: null, embeds: [expEmb], components: [expRow] });
            } catch (_) {}
        }, ACCEPT_TIMEOUT_MS);
    },

    /**
     * Global button handler.
     */
    registerButtonHandler(client) {
        client.on('interactionCreate', async function(interaction) {
            if (!interaction.isButton()) return;
            var cid = interaction.customId;

            // ── ACCEPT CHALLENGE ──────────────────────────────────
            if (cid === 'rrpvp_accept') {
                try {
                    // Defer IMMEDIATELY so async balance lookups (below) never
                    // trigger Discord's 3-second timeout on the button.
                    await interaction.deferUpdate();
                } catch (e) {
                    return; // interaction already closed (10062/40060)
                }

                var challengeId = interaction.message.id;
                var challenge = challenges.get(challengeId);
                if (!challenge || challenge.accepted) {
                    return interaction.followUp({ content: 'This challenge is no longer active.', ephemeral: true });
                }

                var chalId = interaction.user.id;
                if (chalId === challenge.hostId) {
                    return interaction.followUp({ content: 'You cannot accept your own duel!', ephemeral: true });
                }

                // Check challenger balance
                var chalBal = await balanceManager.getBalance(chalId);
                if (challenge.bet > chalBal) {
                    return interaction.followUp({ content: '❌ Yetersiz bakiye! You have ' + formatCredits(chalBal) + '.', ephemeral: true });
                }

                challenge.accepted = true;
                var hostId = challenge.hostId;
                var hostName = challenge.hostName;
                var chalName = interaction.user.username;
                var bet = challenge.bet;
                challenges.delete(challengeId);

                // Deduct challenger bet
                await balanceManager.updateBalance(chalId, chalBal - bet);


                // Build cylinder (secure random bullet position)
                var bulletPos = randomInt(0, CHAMBERS);

                // Decide who goes first
                var firstIsHost = randomInt(0, 2) === 0;
                var playerA = firstIsHost ? hostId : chalId;
                var playerB = firstIsHost ? chalId : hostId;
                var playerAName = firstIsHost ? hostName : chalName;
                var playerBName = firstIsHost ? chalName : hostName;

                var gameId = interaction.message.id; // reuse the challenge message
                var pot = bet * 2;

                var duel = {
                    playerA: playerA,
                    playerAName: playerAName,
                    playerB: playerB,
                    playerBName: playerBName,
                    currentPlayer: playerA,
                    currentPlayerName: playerAName,
                    otherPlayer: playerB,
                    otherPlayerName: playerBName,
                    bulletPos: bulletPos,
                    currentChamber: 0,
                    chambersLeft: CHAMBERS,
                    bet: bet,
                    pot: pot,
                    channelId: interaction.channelId,
                    turnTimeoutId: null
                };
                duels.set(gameId, duel);

                // Show initial Who-first message
                var startEmb = new EmbedBuilder()
                    .setColor(COLORS.NEUTRAL)
                    .setTitle('🔫 Russian Roulette Duel')
                    .setDescription('Cylinder loaded with **1 bullet** in **6 chambers**.\n\n<@' + playerA + '> goes first!')
                    .addFields(
                        { name: 'Player 1', value: '<@' + playerA + '>', inline: true },
                        { name: 'Player 2', value: '<@' + playerB + '>', inline: true },
                        { name: 'Pot', value: formatCredits(pot), inline: true }
                    )
                    .setFooter(footer('Russian Roulette Duel'));

                try {
                    await interaction.editReply({ content: null, embeds: [startEmb], components: [] });
                } catch (_) {}

                await sleep(1500);

                // Show turn 1 embed
                var turnEmb = buildDuelEmbed(duel.currentPlayer, duel.otherPlayer, duel.chambersLeft, pot);
                var pullRow = buildPullButton(gameId);

                try {
                    await interaction.editReply({ content: null, embeds: [turnEmb], components: [pullRow] });
                } catch (_) {}

                // Start turn timeout
                startTurnTimeout(interaction, gameId, duel);
                return;
            }

            // ── PULL TRIGGER ───────────────────────────────────────
            if (!cid.startsWith('rrpvp_pull:')) return;

            var gameId = cid.split(':')[1];
            var duel = duels.get(gameId);
            if (!duel) {
                return interaction.reply({ content: 'This duel is no longer active.', ephemeral: true });
            }

            var clickerId = interaction.user.id;
            if (clickerId !== duel.currentPlayer) {
                return interaction.reply({ content: 'It is not your turn!', ephemeral: true });
            }

            await interaction.deferUpdate();

            // Clear turn timeout
            if (duel.turnTimeoutId) clearTimeout(duel.turnTimeoutId);

            var isBullet = duel.currentChamber === duel.bulletPos;
            duel.currentChamber++;
            duel.chambersLeft--;

            if (isBullet) {
                // ── BANG ──────────────────────────────────────
                var winnerId = duel.otherPlayer;
                var winnerName = duel.otherPlayerName;
                var loserId = duel.currentPlayer;
                var loserName = duel.currentPlayerName;
                duels.delete(gameId);

                var winBal = await balanceManager.getBalance(winnerId);
                await balanceManager.updateBalance(winnerId, winBal + duel.pot);

                var bangEmb = new EmbedBuilder()
                    .setColor(COLORS.ERROR)
                    .setTitle('🔫 Russian Roulette Duel')
                    .setDescription('💥 **BANG!** <@' + loserId + '> pulled a live round!\n\n🏆 <@' + winnerId + '> wins **' + formatCredits(duel.pot) + '**!')
                    .setFooter(footer('Duel settled'));

                var doneRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('rrpvp_done').setLabel('Game Over').setEmoji('💥').setStyle(ButtonStyle.Danger).setDisabled(true)
                );

                try {
                    await interaction.editReply({ content: null, embeds: [bangEmb], components: [doneRow] });
                } catch (_) {}
                return;
            }

            // ── CLICK (blank) ────────────────────────────────────
            var clickEmb = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('🔫 Russian Roulette Duel')
                .setDescription('🔓 *Click!* The chamber was empty. Passing the gun...')
                .setFooter(footer('Russian Roulette Duel'));

            try {
                await interaction.editReply({ content: null, embeds: [clickEmb], components: [] });
            } catch (_) {}

            await sleep(1000);

            // Swap turns
            var tmpPlayer = duel.currentPlayer;
            var tmpName = duel.currentPlayerName;
            duel.currentPlayer = duel.otherPlayer;
            duel.currentPlayerName = duel.otherPlayerName;
            duel.otherPlayer = tmpPlayer;
            duel.otherPlayerName = tmpName;

            var turnEmb = buildDuelEmbed(duel.currentPlayer, duel.otherPlayer, duel.chambersLeft, duel.pot);
            var pullRow = buildPullButton(gameId);

            try {
                await interaction.editReply({ content: null, embeds: [turnEmb], components: [pullRow] });
            } catch (_) {}

            // Re-arm turn timeout
            startTurnTimeout(interaction, gameId, duel);
        });
    },

    balanceManager: balanceManager
};

/**
 * Starts (or restarts) the 30s per-turn inactivity timeout.
 */
function startTurnTimeout(interaction, gameId, duel) {
    if (duel.turnTimeoutId) clearTimeout(duel.turnTimeoutId);
    duel.turnTimeoutId = setTimeout(async function() {
        var d = duels.get(gameId);
        if (!d) return;
        duels.delete(gameId);

        // Other player wins by forfeit
        var winBal = await balanceManager.getBalance(d.otherPlayer);
        await balanceManager.updateBalance(d.otherPlayer, winBal + d.pot);

        try {
            var expRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rrpvp_tout').setLabel('Time Expired').setEmoji('⏰').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            var expEmb = new EmbedBuilder()
                .setColor(COLORS.ERROR)
                .setTitle('🔫 Russian Roulette Duel')
                .setDescription('⏰ <@' + d.currentPlayer + '> took too long!\n\n🏆 <@' + d.otherPlayer + '> wins **' + formatCredits(d.pot) + '** by forfeit!')
                .setFooter(footer('Turn timeout'));
            await interaction.editReply({ content: null, embeds: [expEmb], components: [expRow] });
        } catch (_) {}
    }, TURN_TIMEOUT_MS);
}

