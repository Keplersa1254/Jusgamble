'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const userdata = require('../../games/userdata');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');
const { randomInt } = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and bet on heads or tails!')
        .addStringOption(function(opt) {
            return opt.setName('choice')
                .setDescription('Heads or tails?')
                .setRequired(true)
                .addChoices(
                    { name: '🪙 Heads', value: 'heads' },
                    { name: '🪙 Tails', value: 'tails' }
                );
        })
        .addIntegerOption(function(opt) {
            return opt.setName('bet')
                .setDescription('Amount of credits to bet (min 10)')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET);
        }),

    async execute(interaction) {
        await interaction.deferReply();

        var choice = interaction.options.getString('choice');
        var bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }

        if (bet < 10) {
            return interaction.editReply({ content: '❌ Minimum bet is 10 🪙.' });
        }

        var userId = interaction.user.id;
        var userName = interaction.user.username;

        // Check balance
        var userBalance = await balanceManager.getBalance(userId);
        if (bet > userBalance) {
            return interaction.editReply({ content: '❌ Yetersiz bakiye! You have ' + formatCredits(userBalance) + '.' });
        }

        // Deduct bet immediately
        await balanceManager.updateBalance(userId, userBalance - bet);

        // Flip the coin with crypto.randomInt (true 50/50, no PRNG bias).
        // Picked BEFORE the animation so the spin is purely cosmetic.
        var result = randomInt(0, 2) === 0 ? 'heads' : 'tails';
        var won = result === choice;

        // ── SPIN ANIMATION (4 frames × 500ms = 2s) ────────────────────────
        var spinFrames = ['🪙 Heads...', '🪙 Tails...', '🪙 Heads...', '🪙 Tails...'];
        for (var i = 0; i < spinFrames.length; i++) {
            var spinEmbed = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('Coin Flip')
                .setDescription(userName + '\n\n' + spinFrames[i] + '\nBet: ' + formatCredits(bet))
                .setFooter(footer('Flipping…', interaction.createdAt));

            try {
                await interaction.editReply({ embeds: [spinEmbed] });
            } catch (_) { /* frame failed — skip and keep going */ }

            if (i < spinFrames.length - 1) {
                await new Promise(function(r) { setTimeout(r, 500); });
            }
        }

        // ── RESOLVE PAYOUT ───────────────────────────────────────────────
        var newBalance;
        if (won) {
            newBalance = (await balanceManager.updateBalance(userId, (userBalance - bet) + bet * 2)).balance;
        } else {
            newBalance = userBalance - bet;
        }

        var profit = won ? bet : -bet;
        var coinLabel = result === 'heads' ? 'Heads' : 'Tails';

        var embed = new EmbedBuilder()
            .setColor(won ? COLORS.SUCCESS : COLORS.ERROR)
            .setTitle('Coin Flip')
            .setDescription(userName)
            .addFields(
                { name: 'Choice', value: '🪙 ' + (choice === 'heads' ? 'Heads' : 'Tails'), inline: true },
                { name: 'Landed', value: '🪙 ' + coinLabel, inline: true },
                { name: 'Result', value: won ? '✅ WIN' : '❌ LOSS', inline: true },
                { name: 'Bet', value: formatCredits(bet), inline: true },
                { name: 'Profit', value: (profit >= 0 ? '+' : '') + formatCredits(profit), inline: true },
                { name: 'Balance', value: formatCredits(newBalance), inline: true }
            )
            .setFooter(footer('Coinflip', interaction.createdAt));

        await interaction.editReply({ embeds: [embed] });

        // Track outcome in the JSON userdata store (best-effort).
        try { await userdata.recordGameResult(userId, 'coinflip', won ? 'win' : 'loss', bet); } catch (_) {}
    },

    balanceManager: balanceManager
};
