'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { randomUUID } = require('crypto');
const { MinesweeperEngine } = require('../logic/minesweeperEngine');
const { COLORS, MAX_BET, formatCredits, footer } = require('../../utils/ui');
const balanceManager = require('../../games/balance');

/**
 * Active games live here until the player explicitly hits a mine, cashes
 * out, or forfeits. No TTL sweep — sessions survive indefinitely so the
 * player can wait 30+ minutes between clicks without "Game Expired".
 */
const games = new Map();

function buildBoardComponents(gameId, engine) {
    const rows = [];
    for (let r = 0; r < engine.rows; r++) {
        const rowBtns = [];
        for (let c = 0; c < engine.cols; c++) {
            const k = `${r},${c}`;
            const emoji = engine.cellEmoji(r, c);
            const over = engine.status !== 'playing';
            const disabled = over || engine.revealed.has(k);
            rowBtns.push(
                new ButtonBuilder()
                    .setCustomId(`ms_${r}_${c}:${gameId}`)
                    .setEmoji(emoji)
                    .setStyle(over && engine.mines.has(k) ? ButtonStyle.Danger : ButtonStyle.Secondary)
                    .setDisabled(disabled)
            );
        }
        rows.push(new ActionRowBuilder().addComponents(rowBtns));
    }

    // Control row: cashout, forfeit

    const cashoutValue = (Math.floor(engine.currentMultiplier * 100) / 100).toFixed(2);
    const cashoutBtn = new ButtonBuilder()
        .setCustomId(`ms_cashout:${gameId}`)
        .setEmoji('💵')
        .setLabel(`Cashout ${cashoutValue}x`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(engine.status !== 'playing');

    const forfeitBtn = new ButtonBuilder()
        .setCustomId(`ms_forfeit:${gameId}`)
        .setEmoji('❌')
        .setLabel('Forfeit')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(engine.status !== 'playing');

    rows.push(new ActionRowBuilder().addComponents(cashoutBtn, forfeitBtn));
    return rows;
}

function buildEmbed(engine, betAmount = 0) {
    let color = COLORS.NEUTRAL;
    let desc = '';

    if (engine.status === 'won') {
        color = COLORS.SUCCESS;
        desc = '🏆 All safe! You cleared the board.';
    } else if (engine.status === 'lost') {
        color = COLORS.ERROR;
        desc = '💥 Mine hit! You lost your bet.';
    } else if (engine.status === 'cashed_out') {
        color = COLORS.SUCCESS;
        const payout = Math.floor(betAmount * engine.currentMultiplier);
        const profit = payout - betAmount;
        desc = '💰 CASHED OUT\n' +
            'Payout: ' + formatCredits(payout) + '\n' +
            'Profit: ' + (profit >= 0 ? '+' : '') + formatCredits(profit) + '\n' +
            'Final multiplier: `' + engine.currentMultiplier.toFixed(2) + 'x`';
    } else {
        const mult = engine.currentMultiplier.toFixed(2);
        const next = engine.nextMultiplier.toFixed(2);
        const cashout = formatCredits(Math.floor(betAmount * engine.currentMultiplier));
        
        // Show penalty state if multiplier is below 1.00x
        let multDisplay = 'Multiplier: `' + mult + 'x`';
        if (engine.currentMultiplier < 1.00) {
            multDisplay += ' (Break-even at ' + engine.breakEvenAt + ' tiles!)';
        }
        
        desc = '🎮 Bet: ' + formatCredits(betAmount) +
            '  |  Difficulty: ' + engine.diffLabel +
            ' • ' + engine.mineCount + '💣\n' +
            multDisplay + '\n' +
            'Cashout: **' + cashout + '** (Next tile: `' + next + 'x`)';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setTitle('💣 Casino Mines')
        .setDescription(desc)
        .setFooter(footer('Casino Mines'));
}

const data = new SlashCommandBuilder()
    .setName('minesweeper')
    .setDescription('Play Casino Mines — reveal gems, dodge mines, cash out!')
    .addIntegerOption(option =>
        option.setName('bet')
            .setDescription('Amount of credits to bet')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_BET))
    .addStringOption(option =>
        option.setName('difficulty')
            .setDescription('Risk level')
            .setRequired(true)
            .addChoices(
                { name: '🟢 Easy (3 mines)', value: 'easy' },
                { name: '🟡 Medium (5 mines)', value: 'medium' },
                { name: '🔴 Hard (8 mines)', value: 'hard' }
            ));

async function execute(interaction) {
    await interaction.deferReply();

    const bet = interaction.options.getInteger('bet');
    if (bet > MAX_BET) {
        return interaction.editReply({ content: '❌ Maximum bet is ' + formatCredits(MAX_BET) + '.' });
    }
    const diff = interaction.options.getString('difficulty');

    if (bet <= 0) {
        return interaction.editReply({ content: 'Bet must be a positive amount.' });
    }

    const userId = interaction.user.id;
    const userBalance = await balanceManager.getBalance(userId);
    if (bet > userBalance) {
        return interaction.editReply({ content: `Your broke gng, you have ${userBalance} 🪙` });
    }

    // Deduct the bet immediately.
    await balanceManager.updateBalance(userId, userBalance - bet);

    const engine = new MinesweeperEngine(diff);
    const gameId = randomUUID();

    games.set(gameId, {
        engine,
        userId,
        betAmount: bet
    });

    const embed = buildEmbed(engine, bet);
    const components = buildBoardComponents(gameId, engine);
    await interaction.editReply({ embeds: [embed], components });
}

module.exports = { data, execute, get games() { return games; }, buildEmbed, buildBoardComponents, balanceManager };
