'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crates = require('../../games/crates');
const { COLORS, footer } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crateinfo')
        .setDescription('Learn about crates — drop rates, rewards, and how to open them.'),

    async execute(interaction) {
        await interaction.deferReply();

        var lines = [];
        for (const key of crates.RARITY_ORDER) {
            var r = crates.RARITIES[key];
            var range = r.min.toLocaleString('en-US') + ' – ' + r.max.toLocaleString('en-US');
            lines.push(r.emoji + ' **' + r.label + '** — ' + crates.formatDropRate(key) + ' drop • `' + range + '` 🪙');
        }

        var embed = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle('📦 Crate Guide')
            .setDescription('Earn crates from `/daily`, then open them for credits!\n\n**Drop Rates & Rewards**\n' + lines.join('\n'))
            .addFields(
                { name: '🎁 Open a crate',   value: '`/crate` — choose a rarity and open it for a random reward.', inline: false },
                { name: '🎒 View inventory', value: '`/inventory` — see how many unopened crates you own.', inline: false }
            )
            .setFooter(footer('Crate Info', interaction.createdAt));

        await interaction.editReply({ embeds: [embed] });
    }
};
