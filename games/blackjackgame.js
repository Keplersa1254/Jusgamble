'use strict';

/**
 * Blackjack game engine.
 * Encapsulates all game logic so it can be unit-tested independently of Discord.
 */
class BlackjackGame {
    constructor() {
        /** @type {string[]} The deck of cards (e.g. "A♠", "10♥"). */
        this.deck = [];
        /** @type {string[]} The player's hand. */
        this.playerHand = [];
        /** @type {string[]} The dealer's hand. */
        this.dealerHand = [];
        /** @type {boolean} Whether the player has stood. */
        this.playerStood = false;
        /** @type {boolean} Whether the game is over. */
        this.gameOver = false;
        /** @type {string} The outcome: 'win', 'lose', 'push', 'bust', 'blackjack', 'surrender'. */
        this.outcome = null;
        /** @type {number} The player's current bet. */
        this.bet = 0;
    }

    /**
     * Card suits.
     * @returns {string[]}
     */
    static get SUITS() {
        return ['♠', '♥', '♦', '♣'];
    }

    /**
     * Card ranks.
     * @returns {string[]}
     */
    static get RANKS() {
        return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    }

    /**
     * Builds a fresh 52-card deck.
     * @returns {string[]}
     */
    static createDeck() {
        const deck = [];
        for (const suit of BlackjackGame.SUITS) {
            for (const rank of BlackjackGame.RANKS) {
                deck.push(`${rank}${suit}`);
            }
        }
        return deck;
    }

    /**
     * Shuffles an array in place using the Fisher-Yates algorithm.
     * @param {string[]} array
     * @returns {string[]}
     */
    static shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Returns the numeric value of a single card.
     * @param {string} card
     * @returns {number}
     */
    static cardValue(card) {
        const rank = card.slice(0, -1);
        if (rank === 'A') return 11;
        if (['J', 'Q', 'K'].includes(rank)) return 10;
        return parseInt(rank, 10);
    }

    /**
     * Calculates the best hand value, treating Aces as 11 or 1 as needed.
     * @param {string[]} hand
     * @returns {number}
     */
    static handValue(hand) {
        let total = 0;
        let aces = 0;
        for (const card of hand) {
            total += BlackjackGame.cardValue(card);
            if (card.startsWith('A')) aces++;
        }
        while (total > 21 && aces > 0) {
            total -= 10;
            aces--;
        }
        return total;
    }

    /**
     * Returns true if the hand is a natural blackjack (Ace + 10-value card).
     * @param {string[]} hand
     * @returns {boolean}
     */
    static isBlackjack(hand) {
        return hand.length === 2 && BlackjackGame.handValue(hand) === 21;
    }

    /**
     * Deals a single card from the top of the deck.
     * @returns {string}
     */
    dealCard() {
        if (this.deck.length === 0) {
            this.deck = BlackjackGame.shuffle(BlackjackGame.createDeck());
        }
        return this.deck.pop();
    }

    /**
     * Starts a new round with the given bet amount.
     * @param {number} bet
     * @returns {{playerHand: string[], dealerHand: string[], playerValue: number, dealerValue: number, blackjack: boolean}}
     */
    startRound(bet) {
        if (typeof bet !== 'number' || bet <= 0) {
            throw new Error('A valid positive bet amount is required.');
        }
        this.bet = bet;
        this.deck = BlackjackGame.shuffle(BlackjackGame.createDeck());
        this.playerHand = [this.dealCard(), this.dealCard()];
        this.dealerHand = [this.dealCard(), this.dealCard()];
        this.playerStood = false;
        this.gameOver = false;
        this.outcome = null;

        const playerValue = BlackjackGame.handValue(this.playerHand);
        const dealerValue = BlackjackGame.handValue(this.dealerHand);
        const blackjack = BlackjackGame.isBlackjack(this.playerHand);

        if (blackjack) {
            this.gameOver = true;
            this.outcome = 'blackjack';
        }

        return {
            playerHand: [...this.playerHand],
            dealerHand: [...this.dealerHand],
            playerValue,
            dealerValue,
            blackjack
        };
    }

    /**
     * Player hits (takes another card).
     * @returns {{playerHand: string[], playerValue: number, bust: boolean, blackjack: boolean, gameOver: boolean, outcome: ?string}}
     */
    hit() {
        if (this.gameOver) {
            throw new Error('The game is already over.');
        }
        this.playerHand.push(this.dealCard());
        const playerValue = BlackjackGame.handValue(this.playerHand);
        const bust = playerValue > 21;

        if (bust) {
            this.gameOver = true;
            this.outcome = 'bust';
        }

        return {
            playerHand: [...this.playerHand],
            playerValue,
            bust,
            blackjack: BlackjackGame.isBlackjack(this.playerHand),
            gameOver: this.gameOver,
            outcome: this.outcome
        };
    }

    /**
     * Player stands. The dealer then plays out their hand.
     * @returns {{dealerHand: string[], dealerValue: number, outcome: string, playerValue: number}}
     */
    stand() {
        if (this.gameOver) {
            throw new Error('The game is already over.');
        }
        this.playerStood = true;
        const playerValue = BlackjackGame.handValue(this.playerHand);

        // Dealer hits on 16 and below, stands on 17 and above.
        while (BlackjackGame.handValue(this.dealerHand) < 17) {
            this.dealerHand.push(this.dealCard());
        }

        const dealerValue = BlackjackGame.handValue(this.dealerHand);
        this.gameOver = true;
        this.outcome = this.determineOutcome(playerValue, dealerValue);

        return {
            dealerHand: [...this.dealerHand],
            dealerValue,
            outcome: this.outcome,
            playerValue
        };
    }

    /**
     * Player doubles down: doubles the bet, takes exactly one card, then stands.
     * @returns {{playerHand: string[], playerValue: number, bust: boolean, outcome: ?string, gameOver: boolean}}
     */
    doubleDown() {
        if (this.gameOver) {
            throw new Error('The game is already over.');
        }
        if (this.playerHand.length !== 2) {
            throw new Error('Double down is only allowed on the initial two cards.');
        }
        this.bet *= 2;
        this.playerHand.push(this.dealCard());
        const playerValue = BlackjackGame.handValue(this.playerHand);
        const bust = playerValue > 21;

        if (bust) {
            this.gameOver = true;
            this.outcome = 'bust';
        } else {
            const standResult = this.stand();
            return {
                playerHand: [...this.playerHand],
                playerValue,
                bust,
                outcome: standResult.outcome,
                gameOver: this.gameOver
            };
        }

        return {
            playerHand: [...this.playerHand],
            playerValue,
            bust,
            outcome: this.outcome,
            gameOver: this.gameOver
        };
    }

    /**
     * Player surrenders: forfeits half the bet and ends the round.
     * Only allowed on the initial hand (before any action).
     * @returns {{outcome: string, bet: number}}
     */
    surrender() {
        if (this.gameOver) {
            throw new Error('The game is already over.');
        }
        if (this.playerHand.length !== 2) {
            throw new Error('Surrender is only allowed on the initial two cards.');
        }
        this.gameOver = true;
        this.outcome = 'surrender';
        return { outcome: this.outcome, bet: this.bet };
    }

    /**
     * Determines the outcome given final hand values.
     * @param {number} playerValue
     * @param {number} dealerValue
     * @returns {string}
     */
    determineOutcome(playerValue, dealerValue) {
        if (playerValue > 21) return 'bust';
        if (dealerValue > 21) return 'win';
        if (playerValue > dealerValue) return 'win';
        if (playerValue < dealerValue) return 'lose';
        return 'push';
    }

    /**
     * Calculates the payout multiplier for the current outcome.
     * - blackjack: 2.5x (3:2 payout)
     * - win: 2x (even money)
     * - push: 1x (bet returned)
     * - lose/bust/surrender: 0x (lost)
     * @returns {number}
     */
    getPayoutMultiplier() {
        if (!this.gameOver) return 0;
        switch (this.outcome) {
            case 'blackjack':
                return 2.5;
            case 'win':
                return 2;
            case 'push':
                return 1;
            case 'lose':
            case 'bust':
                return 0;
            case 'surrender':
                return 0.5;
            default:
                return 0;
        }
    }

    /**
     * Returns a human-readable description of the current game state.
     * @returns {string}
     */
    getStateDescription() {
        const playerValue = BlackjackGame.handValue(this.playerHand);
        const parts = [`Player: ${this.playerHand.join(' ')} (${playerValue})`];

        if (this.gameOver) {
            const dealerValue = BlackjackGame.handValue(this.dealerHand);
            parts.push(`Dealer: ${this.dealerHand.join(' ')} (${dealerValue})`);
            parts.push(`Outcome: ${this.outcome}`);
        } else {
            parts.push(`Dealer: ${this.dealerHand[0]} ?`);
        }

        return parts.join(' | ');
    }

    /**
     * Serializes the game state to a plain object so it can be persisted
     * (e.g. to disk) and restored later using {@link fromState}.
     * @returns {Object}
     */
    toState() {
        return {
            deck: [...this.deck],
            playerHand: [...this.playerHand],
            dealerHand: [...this.dealerHand],
            playerStood: this.playerStood,
            gameOver: this.gameOver,
            outcome: this.outcome,
            bet: this.bet
        };
    }

    /**
     * Reconstructs a BlackjackGame from a previously-serialized state.
     * @param {Object} state
     * @returns {BlackjackGame}
     */
    static fromState(state) {
        const game = new BlackjackGame();
        game.deck = Array.isArray(state.deck) ? [...state.deck] : [];
        game.playerHand = Array.isArray(state.playerHand) ? [...state.playerHand] : [];
        game.dealerHand = Array.isArray(state.dealerHand) ? [...state.dealerHand] : [];
        game.playerStood = !!state.playerStood;
        game.gameOver = !!state.gameOver;
        game.outcome = state.outcome || null;
        game.bet = typeof state.bet === 'number' ? state.bet : 0;
        return game;
    }
}

module.exports = BlackjackGame;
