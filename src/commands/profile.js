'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const { formatCredits, footer } = require('../../utils/ui');

const COLOR = 0x8A2BE2;  // Purple
const BASE  = 5000;      // credits to reach Level 2
const STEP  = 2500;      // +credits per level

/** Required_Money = 5000 + (level - 1) * 2500 */
const requiredMoney = level => BASE + (level - 1) * STEP;

function levelFromEarnings(earnings) {
    let level = 1;
    while (requiredMoney(level) <= earnings) level++;
    return level;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription("View a player's profile — level, rank, ratio and money.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The player to view (defaults to yourself)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        const target = interaction.options.getUser('user') || interaction.user;
        const userId = target.id;
        const isSelf = userId === interaction.user.id;

        let userDoc;
        let leaderboard;
        try {
            // Read-only fetch — never seeds phantom records for other users.
            userDoc = await balanceManager.getUser(userId);
            leaderboard = await balanceManager.getAllUsers();
        } catch (error) {
            console.error('❌ [/profile] MongoDB query failed:', error);
            await interaction.editReply({ content: 'Could not load that profile right now — please try again later.' });
            return;
        }

        if (!userDoc && !isSelf) {
            return interaction.editReply({ content: '**' + target.username + "** doesn't have a profile yet." });
        }

        const balance = userDoc ? (userDoc.balance ?? 1000) : 1000;
        const wins = userDoc ? (userDoc.totalWins || 0) : 0;
        const losses = userDoc ? (userDoc.totalLosses || 0) : 0;
        const earnings = userDoc ? (userDoc.totalEarned || 0) : 0;
        const totalSpent = userDoc ? (userDoc.totalSpent || 0) : 0;

        // Level system: level is based on Total Earned, never on balance.
        // Required_Money = 5000 + (level - 1) * 2500.
        const level = levelFromEarnings(earnings);
        const nextAt = requiredMoney(level);
        const prevAt = level === 1 ? 0 : requiredMoney(level - 1);
        const into = earnings - prevAt;
        const progress = Math.min(100, Math.max(0, Math.round((into / (nextAt - prevAt)) * 100)));
        const bar = '▰'.repeat(Math.floor(progress / 10)) + '▱'.repeat(10 - Math.floor(progress / 10));
        const remaining = Math.max(0, nextAt - earnings);

        const rankIndex = leaderboard.findIndex(u => String(u.userId) === String(userId));
        const rank = rankIndex === -1 ? '—' : '#' + (rankIndex + 1);

        const ratio = losses > 0
            ? (wins / losses).toFixed(2)
            : (wins > 0 ? '∞' : '0.00');
        const totalGames = wins + losses;
        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) + '%' : '0%';

        const embed = new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(target.username)
            .setThumbnail(target.displayAvatarURL({ size: 256 }))
            .setDescription(
                'Level **' + level + '**  ' + bar + '  `' + progress + '%`\n' +
                '`' + formatCredits(remaining) + '` left to Level ' + (level + 1)
            )
            .addFields(
                { name: 'Balance', value: formatCredits(balance), inline: true },
                { name: 'Rank', value: '`' + rank + '`', inline: true },
                { name: 'W/L Ratio', value: wins + 'W · ' + losses + 'L\n`' + ratio + '`', inline: true },
                { name: 'Win Rate', value: '`' + winRate + '`', inline: true },
                { name: 'Total Earned', value: formatCredits(earnings), inline: true },
                { name: 'Total Spent', value: formatCredits(totalSpent), inline: true }
            )
            .setFooter(footer('Profile'));

        await interaction.editReply({ embeds: [embed] });
    }
};