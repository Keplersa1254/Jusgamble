'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { footer } = require('../../utils/ui');

const COLOR = 0x5865F2; // Discord blurple
const VOTE_URL = 'https://discordbotlist.com/bots/jusgamble/upvote';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Vote for Jusgamble on Discord Bot List!'),

    async execute(interaction) {
        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('🗳️ Vote for Jusgamble')
            .setDescription('Click the button below to upvote Jusgamble on Discord Bot List!')
            .setFooter(footer('Vote'));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Upvote')
                .setEmoji('⬆️')
                .setStyle(ButtonStyle.Link)
                .setURL(VOTE_URL)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
    }
};
