'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const balanceManager = require('../../games/balance');
const userdata = require('../../games/userdata');
const { MAX_BET, formatCredits, footer } = require('../../utils/ui');
const { randomInt } = require('crypto');

const WIN_COLOR  = 0x2ECC71; // Green
const LOSS_COLOR = 0xE74C3C; // Red
const TIE_COLOR  = 0xF1C40F; // Yellow

const rollDie = () => randomInt(1, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Roll two dice against the bot — higher total wins!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('Amount of credits to bet')
                .setRequired(true)
                .setMinValue(10)
                .setMaxValue(MAX_BET)),

    async execute(interaction) {
        await interaction.deferReply();

        const bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }
        const userId = interaction.user.id;

        if (bet < 10) {
            return interaction.editReply({ content: '❌ Minimum bet is 10 🪙.' });
        }

        const userBalance = await balanceManager.getBalance(userId);
        if (bet > userBalance) {
            return interaction.editReply({ content: '❌ Your broke gng, you have ' + formatCredits(userBalance) + '.' });
        }

        // Deduct bet immediately.
        await balanceManager.updateBalance(userId, userBalance - bet);

        // Roll bot first, then player.
        const botDice = [rollDie(), rollDie()];
        const playerDice = [rollDie(), rollDie()];
        const botTotal = botDice[0] + botDice[1];
        const playerTotal = playerDice[0] + playerDice[1];

        // ── ANIMATION SEQUENCE ──────────────────────────────────────

        // Frame 1: Rolling...
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(TIE_COLOR)
                .setTitle('🎲 Rolling Dice...')
                .setDescription('Bet: ' + formatCredits(bet))
                .setFooter(footer('Rolling...'))]
        });
        await sleep(1000);

        // Frame 2: Bot's roll
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(TIE_COLOR)
                .setTitle('🎲 Rolling Dice...')
                .setDescription('Bot rolled: 🎲 ' + botDice[0] + ' + 🎲 ' + botDice[1] + ' = **' + botTotal + '**\n\n*Waiting for your roll...*')
                .setFooter(footer('Rolling...'))]
        });
        await sleep(1000);

        // ── RESOLVE ─────────────────────────────────────────────────

        const outcome = playerTotal > botTotal ? 'win'
            : playerTotal < botTotal ? 'loss'
            : 'tie';

        // Payout: win = 2x bet, tie = refund, loss = 0.
        let newBalance;
        if (outcome === 'win') {
            newBalance = (await balanceManager.updateBalance(userId, userBalance + bet)).balance;
        } else if (outcome === 'tie') {
            newBalance = (await balanceManager.updateBalance(userId, userBalance)).balance;
        } else {
            newBalance = userBalance - bet;
        }

        const color = outcome === 'win' ? WIN_COLOR : outcome === 'tie' ? TIE_COLOR : LOSS_COLOR;
        const resultText = outcome === 'win' ? 'You win' : outcome === 'tie' ? 'Tie' : 'You lose';

        // Frame 3: Final result
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(color)
                .setTitle('🎲 Dice')
                .setDescription(
                    'Bot rolled: 🎲 ' + botDice[0] + ' + 🎲 ' + botDice[1] + ' = **' + botTotal + '**\n' +
                    'You rolled: 🎲 ' + playerDice[0] + ' + 🎲 ' + playerDice[1] + ' = **' + playerTotal + '**'
                )
                .addFields(
                    { name: 'Bet', value: formatCredits(bet), inline: true },
                    { name: 'Result', value: resultText, inline: true },
                    { name: 'Balance', value: formatCredits(newBalance), inline: true }
                )
                .setFooter(footer('Dice'))]
        });

        // Track outcome (best-effort).
        try { await userdata.recordGameResult(userId, 'dice', outcome === 'win' ? 'win' : outcome === 'tie' ? 'push' : 'loss', bet); } catch (_) {}
    }
};