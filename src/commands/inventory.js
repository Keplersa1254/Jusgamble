'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const crates = require('../../games/crates');
const { COLORS, footer } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your unopened crates.'),

    async execute(interaction) {
        await interaction.deferReply();

        var userId = interaction.user.id;
        var userName = interaction.user.username;

        var counts = await balanceManager.getCrates(userId);

        var total = 0;
        var lines = [];
        for (const key of crates.RARITY_ORDER) {
            var r = crates.RARITIES[key];
            var count = counts[key] || 0;
            total += count;
            lines.push(r.emoji + ' ' + r.label + ': **' + count + '**');
        }

        var embed = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle('🎒 ' + userName + "'s Inventory")
            .setDescription(total === 0
                ? "You don't have any crates yet. Use `/daily` to earn one!"
                : lines.join('\n'))
            .addFields(
                { name: 'Total Crates', value: total + ' crate(s)', inline: true }
            )
            .setFooter(footer('Inventory', interaction.createdAt));

        await interaction.editReply({ embeds: [embed] });
    },

    balanceManager: balanceManager
};
