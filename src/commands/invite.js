'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { footer } = require('../../utils/ui');

const COLOR = 0x8A2BE2; // Purple
const INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=1527346196845170740&permissions=5066687020256320&integration_type=0&scope=bot+applications.commands';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Get an invite link to add the bot to your server.'),

    async execute(interaction) {
        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('Invite Jusgamble')
            .setDescription('Click the button below to add the bot to your server!')
            .setFooter(footer('Invite'));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Add to Server')
                .setStyle(ButtonStyle.Link)
                .setURL(INVITE_URL)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
    }
};