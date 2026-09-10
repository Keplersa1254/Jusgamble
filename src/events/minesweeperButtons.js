'use strict';

/**
 * Button-interaction handler for Casino Mines.
 * Every cell click directly reveals — no flag mode.
 */

const minesweeperCmd = require('../commands/minesweeper');

/**
 * Deposits winnings and deletes the game session.
 * @returns {Promise<void>}
 */
async function settleGame(userId, betAmount, multiplier, gameId) {
    const payout = Math.floor(betAmount * multiplier);
    const bal = await minesweeperCmd.balanceManager.getBalance(userId);
    await minesweeperCmd.balanceManager.updateBalance(userId, bal + payout);
    minesweeperCmd.games.delete(gameId);
}

function register(client) {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('ms_')) return;

        try {
            await interaction.deferUpdate();

            const [tag, gameId] = interaction.customId.split(':');
            if (!tag || !gameId) {
                return interaction.followUp({ content: 'Invalid game button.', ephemeral: true });
            }

            const session = minesweeperCmd.games.get(gameId);
            if (!session) {
                return interaction.followUp({ content: 'Game expired — start a new one with /minesweeper.', ephemeral: true });
            }

            if (interaction.user.id !== session.userId) {
                return interaction.followUp({ content: 'This is not your game.', ephemeral: true });
            }

            const { engine, betAmount, userId } = session;

            // Cash out — collect winnings
            if (tag === 'ms_cashout') {
                if (engine.status !== 'playing') return;
                engine.cashout();
                await settleGame(userId, betAmount, engine.currentMultiplier, gameId);
                await updateMessage(interaction, session, gameId);
                return;
            }

            // Forfeit — lose the bet
            if (tag === 'ms_forfeit') {
                if (engine.status !== 'playing') return;
                engine.status = 'lost';
                minesweeperCmd.games.delete(gameId);
                await updateMessage(interaction, session, gameId);
                return;
            }

            // Cell click — always reveals
            if (engine.status !== 'playing') return;

            const parts = tag.split('_');
            const row = parseInt(parts[1], 10);
            const col = parseInt(parts[2], 10);

            engine.reveal(row, col);

            if (engine.status === 'lost') {
                minesweeperCmd.games.delete(gameId);
            } else if (engine.status === 'won') {
                await settleGame(userId, betAmount, engine.currentMultiplier, gameId);
            }

            await updateMessage(interaction, session, gameId);

        } catch (err) {
            const code = err && err.code;
            if (code === 10062 || code === 40060) {
                console.warn('minesweeper: transient error (code ' + code + ') - ignored.');
                return;
            }
            console.error('minesweeper button error:', err.message || err);
        }
    });
}

async function updateMessage(interaction, session, gameId) {
    const { engine, betAmount } = session;
    const embed = minesweeperCmd.buildEmbed(engine, betAmount);
    const components = minesweeperCmd.buildBoardComponents(gameId, engine);
    await interaction.editReply({ embeds: [embed], components });
}

module.exports = register;
