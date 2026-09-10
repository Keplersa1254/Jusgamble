'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const crates = require('../../games/crates');
const { formatCredits, footer } = require('../../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crate')
        .setDescription('Open a crate from your inventory to win credits.')
        .addStringOption(function(opt) {
            var choices = [];
            for (const key of crates.RARITY_ORDER) {
                var r = crates.RARITIES[key];
                choices.push({ name: r.emoji + ' ' + r.label, value: key });
            }
            return opt.setName('rarity')
                .setDescription('The rarity of the crate to open')
                .setRequired(true)
                .addChoices(choices);
        }),

    async execute(interaction) {
        await interaction.deferReply();

        var userId = interaction.user.id;
        var userName = interaction.user.username;
        var rarity = interaction.options.getString('rarity');

        var result = await balanceManager.openCrate(userId, rarity);

        if (!result.success) {
            var message;
            if (result.error === 'NO_CRATES') {
                var r = crates.RARITIES[rarity];
                message = '❌ You don\'t have any ' + r.label + ' crates! Use `/daily` to earn one.';
            } else if (result.error === 'NO_USER') {
                message = '❌ You don\'t have any crates yet! Use `/daily` to earn one.';
            } else {
                message = '❌ Could not open the crate. Please try again.';
            }
            return interaction.editReply({ content: message });
        }

        var r = crates.RARITIES[rarity];

        var embed = new EmbedBuilder()
            .setColor(r.color)
            .setTitle(r.emoji + ' ' + r.label + ' Crate Opened!')
            .setDescription(userName + ' opened a crate and won **' + formatCredits(result.reward) + '**!')
            .addFields(
                { name: 'Rarity',       value: r.emoji + ' ' + r.label, inline: true },
                { name: 'Reward',       value: '+' + formatCredits(result.reward), inline: true },
                { name: 'New Balance',  value: formatCredits(result.balance), inline: true },
                { name: 'Remaining',    value: result.remaining + ' ' + r.label + ' crate(s)', inline: true }
            )
            .setFooter(footer('Crate', interaction.createdAt));

        await interaction.editReply({ embeds: [embed] });
    },

    balanceManager: balanceManager
};
