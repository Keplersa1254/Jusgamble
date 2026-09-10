'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { footer } = require('../../utils/ui');

const COLOR = 0x8A2BE2; // Purple

/** Formats milliseconds as a compact uptime string. */
function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return d + 'd ' + h + 'h ' + m + 'm ' + sec + 's';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View bot stats — servers, users, uptime and latency.'),

    async execute(interaction) {
        await interaction.deferReply();

        const client = interaction.client;
        const servers = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const ping = Math.round(client.ws.ping);
        const uptime = formatUptime(client.uptime || 0);

        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('Jusgamble · Bot Stats')
            .setDescription(
                ':zap: **' + ping + 'ms** latency\n' +
                ':clock1: Uptime **' + uptime + '**'
            )
            .addFields(
                { name: 'Servers', value: String(servers), inline: true },
                { name: 'Total Users', value: String(totalUsers), inline: true }
            )
            .setFooter(footer('Stats'));

        await interaction.editReply({ embeds: [embed] });
    }
};