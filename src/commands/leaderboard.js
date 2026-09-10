'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const { COLORS, formatCredits, footer } = require('../../utils/ui');

var MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

async function resolveName(client, userId) {
    try {
        var user = await client.users.fetch(userId);
        return user.username;
    } catch (_) {
        return userId.slice(0, 8);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Displays top players with the highest balance.'),

    async execute(interaction) {
        await interaction.deferReply();

        var all = (await balanceManager.getAllUsers()).filter(function(u) { return u.hasPlayed; });
        if (all.length === 0) {
            var emb = new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle('\u{1F3C6} Economy Leaderboard')
                .setDescription('No players yet! Be the first to claim `/daily`.')
                .setFooter(footer('Leaderboard'));
            return interaction.editReply({ embeds: [emb] });
        }

        var top10 = all.slice(0, 10);
        var ids = new Set();
        top10.forEach(function(u) { ids.add(u.userId); });

        var rid = interaction.user.id;
        var inTop = ids.has(rid);
        if (!inTop) ids.add(rid);

        var nm = {};
        for (var uid of ids) nm[uid] = await resolveName(interaction.client, uid);

        var lines = [];
        for (var i = 0; i < top10.length; i++) {
            var u = top10[i];
            var m = i < 3 ? MEDALS[i] + ' ' : '';
            var dn = nm[u.userId] || '??';
            if (u.userId === rid) dn = '**' + dn + '**';
            lines.push(m + (i+1) + '. ' + dn + ' \u2022 `' + u.balance.toLocaleString('en-US') + '` \u{1FA99}');
        }

        var emb = new EmbedBuilder()
            .setColor(COLORS.NEUTRAL)
            .setTitle('\u{1F3C6} Economy Leaderboard')
            .setDescription(lines.join('\n'))
            .setFooter(footer('Leaderboard', interaction.createdAt));

        if (!inTop) {
            var rk = 0;
            for (var j = 0; j < all.length; j++) {
                if (all[j].userId === rid) { rk = j + 1; break; }
            }
            var b = await balanceManager.getBalance(rid);
            var dl = nm[rid] || 'You';
            var d = new Date();
            var hh = String(d.getHours()).padStart(2, '0');
            var mm = String(d.getMinutes()).padStart(2, '0');
            emb.setFooter({ text: 'Your Rank: #' + rk + ' | ' + dl + ' \u2022 ' + formatCredits(b) + ' | Jusgamble \u2022 Today at ' + hh + ':' + mm });
        }

        await interaction.editReply({ embeds: [emb] });
    },

    balanceManager: balanceManager
};
