'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const { COLORS, formatCredits, footer } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your current credit balance.'),

    async execute(interaction) {
        await interaction.deferReply();

        var userId = interaction.user.id;
        var userName = interaction.user.username;
        var balance = await balanceManager.getBalance(userId);
        const user = await balanceManager.getUser(userId);
        var streak = user ? (user.dailyStreak || 0) : 0;

                // Derive global rank from the leaderboard dataset.
        var allUsers = await balanceManager.getAllUsers();
        var rank = '?';
        for (var i = 0; i < allUsers.length; i++) {
            if (allUsers[i].userId === userId) {
                rank = '#' + (i + 1);
                break;
            }
        }

        var embed = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle(userName)
            .setDescription('`' + balance.toLocaleString('en-US') + '` 🪙')
            .addFields(
                { name: 'Balance', value: formatCredits(balance), inline: true },
                { name: '🔥 Streak', value: streak + ' day(s)', inline: true },
                { name: '🌍 Global Rank', value: rank, inline: true }
            )
            .setFooter(footer('Wallet'));

        await interaction.editReply({ embeds: [embed] });
    },

    balanceManager: balanceManager
};
