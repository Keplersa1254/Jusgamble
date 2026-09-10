'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const BalanceManager = require('../../games/balancemanager');
const crates = require('../../games/crates');
const { COLORS, formatCredits, footer } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily streak reward'),

    async execute(interaction) {
        await interaction.deferReply();

        var userId = interaction.user.id;
        var userName = interaction.user.username;
        var result = await balanceManager.claimDaily(userId);

        if (result.claimed) {
            var streak = result.streak || 1;
            // Preview the *next* claim's reward, using the same tunable
            // formula as balancemanager (DAILY_STREAK_* in .env).
            var nextReward = Math.min(BalanceManager.STREAK_BASE + streak * BalanceManager.STREAK_INCREMENT, BalanceManager.STREAK_CAP);

            // In addition to the daily money, grant 1 crate based on the
            // configured drop probabilities (see games/crates.js).
            var rarity = crates.rollCrateRarity();
            await balanceManager.grantCrate(userId, rarity);
            var crate = crates.RARITIES[rarity];

            var embed = new EmbedBuilder()
                .setColor(COLORS.SUCCESS)
                .setTitle(userName)
                .setDescription('+' + formatCredits(result.amount))
                .addFields(
                    { name: '🔥 Streak',    value: streak + ' day(s)', inline: true },
                    { name: 'Next reward',  value: '+' + formatCredits(nextReward), inline: true },
                    { name: 'Balance',      value: formatCredits(result.balance), inline: true },
                    { name: '📦 Crate',     value: crate.emoji + ' ' + crate.label + ' Crate', inline: true }
                )
                .setFooter(footer('Streak', interaction.createdAt));

            await interaction.editReply({ embeds: [embed] });
        } else {
            var streak = result.streak || 0;
            var nextTs = Math.floor(result.nextClaim / 1000);

            var embed = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle(userName)
                .setDescription('Already claimed — try again <t:' + nextTs + ':R>')
                .addFields(
                    { name: '🔥 Current Streak', value: streak + ' day(s)', inline: true },
                    { name: 'Balance',           value: formatCredits(result.balance), inline: true }
                )
                .setFooter(footer('Daily', interaction.createdAt));

            await interaction.editReply({ embeds: [embed] });
        }
    },

    balanceManager: balanceManager
};
