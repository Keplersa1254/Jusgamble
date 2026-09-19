'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { footer } = require('../../utils/ui');

const COLOR = 0x5865F2; // Discord blurple
const VOTE_URL = 'https://discordbotlist.com/bots/jusgamble/upvote';
const TOPGG_URL = 'https://top.gg/bot/1527346196845170740';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Vote for Jusgamble on Discord Bot List!'),

    async execute(interaction) {
        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('🗳️ Vote for Jusgamble')
            .setDescription('Support Jusgamble by voting on both platforms below!')
            .setFooter(footer('Vote'));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Discord Bot List')
                .setEmoji('⬆️')
                .setStyle(ButtonStyle.Link)
                .setURL(VOTE_URL),
            new ButtonBuilder()
                .setLabel('top.gg')
                .setEmoji('⬆️')
                .setStyle(ButtonStyle.Link)
                .setURL(TOPGG_URL)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
    }
};
