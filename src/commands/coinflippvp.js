'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const balanceManager = require('../../games/balance');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');
const { randomInt } = require('crypto');

/**
 * Helper: returns a promise that resolves after ms milliseconds.
 */
function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
}

/**
 * Active PvP duels keyed by the Discord message ID that carries the
 * challenge embed.  Used by the button handler to find pending duels
 * when a challenger clicks "Accept".
 */
var pendingDuels = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip-pvp')
        .setDescription('Challenge another player to a Coinflip duel!')
        .addIntegerOption(function(opt) {
            return opt.setName('bet')
                .setDescription('Amount of credits to wager (min 10)')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET);
        }),

    /**
     * Host starts a duel.  Their bet is deducted immediately and held in
     * escrow until someone accepts (or the challenge times out).
     */
    async execute(interaction) {
        await interaction.deferReply();

        var bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }
        if (bet < 10) {
            return interaction.editReply({ content: '\u274c Minimum bet is 10 \U0001FA99.' });
        }

        var hostId = interaction.user.id;
        var hostName = interaction.user.username;

        // Validate balance
        var hostBalance = await balanceManager.getBalance(hostId);
        if (bet > hostBalance) {
            return interaction.editReply({ content: '\u274c Yetersiz bakiye! You have ' + formatCredits(hostBalance) + '.' });
        }

        // Deduct host bet immediately
        await balanceManager.updateBalance(hostId, hostBalance - bet);

        // Build challenge embed
        var pot = bet * 2;
        var challengeEmbed = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle('\u2694\ufe0f Coinflip Duel')
            .setDescription('<@' + hostId + '> put up **' + formatCredits(bet) + '** for a Coinflip duel! Who will accept?')
            .addFields(
                { name: 'Wager', value: formatCredits(bet), inline: true },
                { name: 'Winner Pot', value: formatCredits(pot), inline: true },
                { name: 'Expires', value: '120 seconds', inline: true }
            )
            .setFooter(footer('Waiting for challenger', interaction.createdAt));

        var acceptBtn = new ButtonBuilder()
            .setCustomId('cfpvp_accept')
            .setLabel('Accept Challenge')
            .setEmoji('\u2694\ufe0f')
            .setStyle(ButtonStyle.Success);

        var row = new ActionRowBuilder().addComponents(acceptBtn);

        // Send the challenge message
        var challengeMsg = await interaction.editReply({
            content: '<@' + hostId + '> started a Coinflip duel!',
            embeds: [challengeEmbed],
            components: [row]
        });

        // Store duel state so the button handler can find it
        var duelId = challengeMsg.id;
        var duel = {
            hostId: hostId,
            hostName: hostName,
            bet: bet,
            channelId: interaction.channelId,
            messageId: duelId,
            accepted: false,
            createdAt: Date.now()
        };
        pendingDuels.set(duelId, duel);

        // 60-second timeout — if nobody accepts, refund the host
        setTimeout(async function() {
            var d = pendingDuels.get(duelId);
            if (!d || d.accepted) return;
            pendingDuels.delete(duelId);

            // Refund host
            var currentBal = await balanceManager.getBalance(hostId);
            await balanceManager.updateBalance(hostId, currentBal + bet);

            // Disable the button
            var expiredRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cfpvp_expired')
                    .setLabel('Challenge Expired')
                    .setEmoji('\u23f0')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            try {
                await challengeMsg.edit({
                    content: 'No challenger stepped up.',
                    embeds: [
                        new EmbedBuilder()
                            .setColor(COLORS.ERROR)
                            .setTitle('\u2694\ufe0f Coinflip Duel — Expired')
                            .setDescription('<@' + hostId + '> bet of **' + formatCredits(bet) + '** has been refunded.')
                            .setFooter(footer('Timeout'))
                    ],
                    components: [expiredRow]
                });
            } catch (_) { /* message may have been deleted */ }
        }, 120000);
    },

    /**
     * Registers a global button handler so Accept clicks resolve even if the
     * collector fires before this runs (belt-and-suspenders).
     */
    registerButtonHandler(client) {
        client.on('interactionCreate', async function(interaction) {
            if (!interaction.isButton()) return;
            if (interaction.customId !== 'cfpvp_accept') return;

            var duelId = interaction.message.id;
            var duel = pendingDuels.get(duelId);
            if (!duel) {
                return interaction.reply({ content: 'This duel is no longer active.', ephemeral: true });
            }
            if (duel.accepted) {
                return interaction.reply({ content: 'Someone already accepted this duel!', ephemeral: true });
            }

            var challengerId = interaction.user.id;

            // Host cannot accept own duel
            if (challengerId === duel.hostId) {
                return interaction.reply({ content: 'You cannot accept your own duel!', ephemeral: true });
            }

            // Mark accepted so no one else can take it
            duel.accepted = true;

            var challengerName = interaction.user.username;
            var bet = duel.bet;

            // Check challenger balance
            var chalBalance = await balanceManager.getBalance(challengerId);
            if (bet > chalBalance) {
                duel.accepted = false; // rollback
                return interaction.reply({ content: '\u274c Yetersiz bakiye! You have ' + formatCredits(chalBalance) + '.', ephemeral: true });
            }

            // Deduct challenger bet
            await balanceManager.updateBalance(challengerId, chalBalance - bet);
            pendingDuels.delete(duelId);

            await interaction.deferUpdate();

            // ── STAGED ANIMATION (3 steps × 750ms ≈ 2.25s) ──────────
            var disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cfpvp_done')
                    .setLabel('Duel in progress...')
                    .setEmoji('\U0001FA99')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            // Step 0: Immediate lock — coin starts flipping
            var emb0 = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('\u2694\ufe0f Duel In Progress...')
                .setDescription('\U0001FA99 Flipping the coin between <@' + duel.hostId + '> and <@' + challengerId + '>...')
                .setFooter(footer('Flipping\u2026'));
            try { await interaction.editReply({ content: null, embeds: [emb0], components: [disabledRow] }); } catch (_) {}
            await sleep(750);

            // Step 1: Coin spinning high
            var emb1 = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('\u2694\ufe0f Duel In Progress...')
                .setDescription('\U0001FA99 The coin is spinning high in the air...')
                .setFooter(footer('Flipping\u2026'));
            try { await interaction.editReply({ content: null, embeds: [emb1] }); } catch (_) {}
            await sleep(750);

            // Step 2: Coin falling
            var emb2 = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('\u2694\ufe0f Duel In Progress...')
                .setDescription('\U0001FA99 It\'s falling back down...')
                .setFooter(footer('Flipping\u2026'));
            try { await interaction.editReply({ content: null, embeds: [emb2] }); } catch (_) {}
            await sleep(750);

            // ── RESOLVE WINNER ──────────────────────────────────────
            var pot = bet * 2;
            var hostWins = randomInt(0, 2) === 0;
            var winnerId = hostWins ? duel.hostId : challengerId;
            var winnerName = hostWins ? duel.hostName : challengerName;
            var loserId = hostWins ? challengerId : duel.hostId;
            var loserName = hostWins ? challengerName : duel.hostName;

            // Pay winner
            var winBalance = await balanceManager.getBalance(winnerId);
            var newBal = (await balanceManager.updateBalance(winnerId, winBalance + pot)).balance;

            var resultEmbed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setTitle('\u{1F3C6} Coinflip Duel Winner!')
                .setDescription('<@' + winnerId + '> won **' + formatCredits(pot) + '** against <@' + loserId + '>!')
                .addFields(
                    { name: 'Winner', value: '<@' + winnerId + '>', inline: true },
                    { name: 'Loser', value: '<@' + loserId + '>', inline: true },
                    { name: 'Pot', value: formatCredits(pot), inline: true },
                    { name: 'Balance', value: formatCredits(newBal), inline: true }
                )
                .setFooter(footer('Duel settled'));

            try {
                await interaction.editReply({ content: null, embeds: [resultEmbed], components: [] });
            } catch (_) {}
        });
    },

    balanceManager: balanceManager,
    get pendingDuels() { return pendingDuels; }
};
