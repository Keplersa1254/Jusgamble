'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { randomUUID } = require('crypto');
const BlackjackGame = require('../../games/blackjackgame');
const balanceManager = require('../../games/balance');
const blackjackStore = require('../../games/blackjackstore');
const userdata = require('../../games/userdata');
const { COLORS, MAX_BET, formatCredits, formatHand, footer } = require('../../utils/ui');

/**
 * Builds the modern blackjack action buttons row.
 * Each action is color-coded with an emoji AND tagged with the game's unique
 * id (`bj_<action>:<gameId>`) so the handler always finds the exact game,
 * even after a bot restart (state is persisted to disk).
 * @param {string} gameId The unique id of this game.
 * @returns {ActionRowBuilder}
 */
function buildGameButtons(gameId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bj_hit:${gameId}`)
            .setLabel('Hit')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`bj_double:${gameId}`)
            .setLabel('Double')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`bj_stand:${gameId}`)
            .setLabel('Stand')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`bj_surrender:${gameId}`)
            .setLabel('Surrender')
            .setStyle(ButtonStyle.Secondary)
    );
}

/**
 * Parses a blackjack button customId of the form "bj_<action>:<gameId>".
 * @param {string} customId
 * @returns {{action: string, gameId: string} | null}
 */
function parseButtonId(customId) {
    const [tag, gameId] = customId.split(':');
    if (!tag || !tag.startsWith('bj_') || !gameId) return null;
    return { action: tag.slice(3), gameId };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Play a round of Blackjack against the dealer!')
        .addIntegerOption(option =>
            option.setName('bet')
                .setDescription('The amount of credits to bet')
                .setRequired(true)
                .setMaxValue(MAX_BET)),

    /**
     * Executes the blackjack command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        // Acknowledge the interaction immediately to avoid the 3-second
        // timeout (DiscordAPIError[10062]). This keeps the interaction
        // "open" so we can later editReply() with the actual result.
        await interaction.deferReply();

        const bet = interaction.options.getInteger('bet');
        if (bet > MAX_BET) {
            return interaction.editReply({ content: 'Maximum bet is ' + formatCredits(MAX_BET) + '.' });
        }

        if (bet <= 0) {
            return interaction.editReply({
                content: 'You must bet a positive amount!'
            });
        }

        const userId = interaction.user.id;

        // Check balance
        const userBalance = await balanceManager.getBalance(userId);
        if (bet > userBalance) {
            return interaction.editReply({
                content: `Your broke gng, you have ${userBalance} 🪙`
            });
        }

        // Allow only one live game per user so buttons always resolve correctly.
        if (await blackjackStore.userHasActiveGame(userId)) {
            return interaction.editReply({
                content: 'You already have an active Blackjack game! Finish it or wait for it to expire before starting another.'
            });
        }

        const game = new BlackjackGame();
        const round = game.startRound(bet);

        // Deduct the bet from the user's balance
        const balanceAfterBet = await balanceManager.updateBalance(userId, userBalance - bet);

        // Persist the game (survives restarts) under a unique id.
        const gameId = randomUUID();
        await blackjackStore.save(gameId, { userId, ...game.toState() });

        const embed = buildGameEmbed(game, round.playerHand, round.playerValue, round.dealerHand, round.dealerValue, round.blackjack);
        const components = round.blackjack ? [] : [buildGameButtons(gameId)];

        if (round.blackjack) {
            // Natural blackjack ends the round immediately — pay out and clean up.
            const payout = await applyPayout(game, userId);
            await blackjackStore.remove(gameId);
            embed.addFields({ name: 'Balance', value: formatCredits(payout.balance), inline: true });

            const winnings = Math.round(game.bet * game.getPayoutMultiplier());
            return interaction.editReply({
                content: formatOutcome(game.outcome, game.bet, winnings, game.getPayoutMultiplier(), payout.balance, payout.reset),
                embeds: [embed],
                components: []
            });
        }

        return interaction.editReply({
            content: 'Make your move.',
            embeds: [embed],
            components
        });
    },

    /**
     * Registers a button interaction handler for blackjack game actions.
     * Called from game.js during bot initialization.
     * @param {import('discord.js').Client} client
     */
    registerButtonHandler(client) {
        client.on('interactionCreate', async interaction => {
            if (!interaction.isButton()) return;
            if (!interaction.customId.startsWith('bj_')) return;

            try {
                // Acknowledge the button press immediately to avoid the 3-second
                // timeout (DiscordAPIError[10062]); we then editReply() with results.
                await interaction.deferUpdate();

                const parsed = parseButtonId(interaction.customId);
                if (!parsed) {
                    return interaction.followUp({
                        content: 'Invalid game button.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const { action, gameId } = parsed;
                const entry = await blackjackStore.get(gameId);

                if (!entry) {
                    return interaction.followUp({
                        content: 'There is no active Blackjack game for this button. Use /blackjack to start a new one!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Only the player who started the game may press its buttons.
                if (interaction.user.id !== entry.userId) {
                    return interaction.followUp({
                        content: 'This is not your Blackjack game — start your own with /blackjack!',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const game = BlackjackGame.fromState(entry);
                let error = null;

                try {
                    switch (action) {
                        case 'hit':
                            game.hit();
                            break;
                        case 'stand':
                            game.stand();
                            break;
                        case 'double':
                            game.doubleDown();
                            break;
                        case 'surrender':
                            game.surrender();
                            break;
                        default:
                            return;
                    }
                } catch (err) {
                    error = err.message;
                }

                if (error) {
                    return interaction.followUp({ content: error, flags: MessageFlags.Ephemeral });
                }

                const playerValue = BlackjackGame.handValue(game.playerHand);
                const dealerValue = BlackjackGame.handValue(game.dealerHand);

                const embed = buildGameEmbed(
                    game,
                    game.playerHand,
                    playerValue,
                    game.dealerHand,
                    dealerValue,
                    false,
                    game.gameOver
                );

                if (game.gameOver) {
                    // Game is over — calculate and apply winnings, then clean up.
                    const payout = await applyPayout(game, entry.userId);
                    await blackjackStore.remove(gameId);

                    embed.addFields({ name: 'Balance', value: formatCredits(payout.balance), inline: true });

                    const winnings = Math.round(game.bet * game.getPayoutMultiplier());
                    return interaction.editReply({
                        content: formatOutcome(game.outcome, game.bet, winnings, game.getPayoutMultiplier(), payout.balance, payout.reset),
                        embeds: [embed],
                        components: []
                    });
                }

                // Save the updated state so it continues to survive restarts.
                await blackjackStore.save(gameId, { userId: entry.userId, ...game.toState() });

                const liveBalance = await balanceManager.getBalance(entry.userId);
                embed.addFields({ name: 'Balance', value: formatCredits(liveBalance), inline: true });

                return interaction.editReply({
                    content: '',
                    embeds: [embed],
                    components: [buildGameButtons(gameId)]
                });
            } catch (err) {
                // Gracefully swallow the 3-second acknowledgment timeout
                // (DiscordAPIError[10062] "Unknown interaction") and other
                // transient Discord REST errors so they never crash the bot.
                const code = err && (err.code ?? err.httpStatus);
                const transient =
                    code === 10062 ||
                    code === 'ECONNRESET' ||
                    code === 'ETIMEDOUT' ||
                    (typeof code === 'number' && code >= 500 && code < 600);

                if (transient) {
                    console.warn('Blackjack button: transient Discord error (code:', code, ') — ignored.');
                    return;
                }

                console.error('Blackjack button error:', err.message || err);
                try {
                    // By this point the interaction has always been deferred,
                    // so followUp is the only safe response channel.
                    await interaction.followUp({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
                } catch (_) {
                    // Interaction already timed out / is closed; nothing to do.
                }
            }
        });
    }
};

module.exports.applyPayout = applyPayout;

/**
 * Applies the payout/winnings for a finished game against the user's CURRENT
 * balance (so any other balance activity in the meantime is respected).
 *
 * Economy rules (bet is deducted up-front when the round starts):
 *   - win        → return bet * 2   (bet back + even-money profit)
 *   - blackjack  → return bet * 2.5 (3:2 payout)
 *   - push/draw  → return bet * 1   (EXACTLY the original bet — net zero)
 *   - surrender  → return bet * 0.5
 *   - lose/bust  → return 0
 *
 * @param {BlackjackGame} game
 * @param {string} userId
 * @param {Object} [balMgr] Optional injected balance manager (for tests).
 * @returns {Promise<{balance: number, reset: boolean, oldBalance: number}>}
 */
async function applyPayout(game, userId, balMgr = balanceManager) {
    const bet = game.bet;
    let winnings;

    switch (game.outcome) {
        case 'win':
            winnings = bet * 2;           // stake back + profit
            break;
        case 'blackjack':
            winnings = Math.round(bet * 2.5); // 3:2
            break;
        case 'push':
            winnings = bet;               // EXACT bet back — net zero, never 2x
            break;
        case 'surrender':
            winnings = Math.round(bet * 0.5);
            break;
        default: // 'lose' | 'bust'
            winnings = 0;
            break;
    }

    const current = await balMgr.getBalance(userId);
    const result = await balMgr.updateBalance(userId, current + winnings);

    // Record the outcome in the JSON stats store — only when running against
    // the real shared balance manager (tests inject an isolated instance and
    // must not write stats).
    if (balMgr === balanceManager) {
        try {
            const outcome = game.outcome;
            const stat = outcome === 'win' || outcome === 'blackjack' ? 'win'
                : outcome === 'push' ? 'push' : 'loss';
            await userdata.recordGameResult(userId, 'blackjack', stat, bet);
        } catch (_) { /* stats must never break a payout */ }
    }

    return result;
}

/**
 * Builds the modern Discord embed for the current game state.
 * Uses the shared palette: neutral base while playing, green on wins,
 * red on losses, gold on pushes. Cards render as inline-code chips.
 * @param {BlackjackGame} game
 * @param {string[]} playerHand
 * @param {number} playerValue
 * @param {string[]} dealerHand
 * @param {number} dealerValue
 * @param {boolean} blackjack
 * @param {boolean} [gameOver=false]
 * @returns {EmbedBuilder}
 */
function buildGameEmbed(game, playerHand, playerValue, dealerHand, dealerValue, blackjack, gameOver = false) {
    const playerBust = playerValue > 21;

    // Palette by state: gold while playing, green on wins, red on losses,
    // cool grey on a push (draw).
    let color = COLORS.NEUTRAL;
    if (blackjack || (gameOver && game.outcome === 'blackjack') || (gameOver && game.outcome === 'win')) {
        color = COLORS.SUCCESS;
    } else if (gameOver && game.outcome === 'push') {
        color = COLORS.DRAW;
    } else if (gameOver) {
        color = COLORS.ERROR;
    }

    const playerHandText = formatHand(playerHand);
    const dealerHandText = gameOver
        ? formatHand(dealerHand)
        : formatHand(dealerHand.slice(0, 1)) + ' `?`';

    const playerValueText = `${playerHandText} • \`${playerValue}\`${playerBust ? ' • BUST' : ''}`;
    const dealerValueText = gameOver ? `${dealerHandText} • \`${dealerValue}\`` : dealerHandText;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🃏 Blackjack')
        .addFields(
            { name: 'You', value: playerValueText, inline: true },
            { name: 'Dealer', value: dealerValueText, inline: true },
            { name: 'Bet', value: formatCredits(game.bet), inline: true }
        )
        .setFooter(footer('Blackjack'));

    if (blackjack) {
        embed.setDescription('Natural Blackjack — paid at 3:2.');
    } else if (gameOver) {
        embed.setDescription(formatOutcomeDescription(game.outcome));
    } else {
        embed.setDescription('Select an action below.');
    }

    return embed;
}

/**
 * Formats the outcome message for the end of a game with credits.
 * @param {string} outcome
 * @param {number} bet
 * @param {number} winnings
 * @param {number} multiplier
 * @param {number} balance
 * @returns {string}
 */
function formatOutcome(outcome, bet, winnings, multiplier, balance) {
    const messages = {
        blackjack: 'Blackjack • ' + formatCredits(winnings) + ' (3:2 payout)',
        win:       'You win • ' + formatCredits(winnings),
        push:      'Push • bet of ' + formatCredits(bet) + ' returned',
        lose:      'Loss • −' + formatCredits(bet),
        bust:      'Bust • −' + formatCredits(bet),
        surrender: 'Surrender • forfeited ' + formatCredits(bet / 2)
    };
    var core = messages[outcome] || 'Game over • outcome: `' + outcome + '`';
    return core + '\nBalance: ' + formatCredits(balance);
}

/**
 * Returns a short description for the embed.
 * @param {string} outcome
 * @returns {string}
 */
function formatOutcomeDescription(outcome) {
    var descriptions = {
        blackjack: 'Natural Blackjack • paid at 3:2',
        win:       'You win',
        push:      'Push • bet returned',
        lose:      'Dealer wins',
        bust:      'Bust • over 21',
        surrender: 'Surrendered'
    };
    return descriptions[outcome] || 'Outcome: `' + outcome + '`';
}
