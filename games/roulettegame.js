'use strict';

/**
 * Roulette game engine.
 * Encapsulates all game logic so it can be unit-tested independently of Discord.
 */
class RouletteGame {
    constructor() {
        /** @type {number} The winning number (0-36). */
        this.winningNumber = null;
        /** @type {string} The winning color ('red' | 'black' | 'green'). */
        this.winningColor = null;
        /** @type {boolean} Whether the wheel has been spun. */
        this.spun = false;
    }

    /**
     * The fixed set of pockets on a European roulette wheel (0-36).
     * @returns {number[]}
     */
    static get POCKETS() {
        return Array.from({ length: 37 }, (_, i) => i);
    }

    /**
     * Red numbers on a European roulette wheel.
     * @returns {number[]}
     */
    static get RED_NUMBERS() {
        return [
            1, 3, 5, 7, 9, 12, 14, 16, 18, 19,
            21, 23, 25, 27, 30, 32, 34, 36
        ];
    }

    /**
     * Returns the color for a given pocket number.
     * @param {number} number
     * @returns {string} 'red' | 'black' | 'green'
     */
    static getColor(number) {
        if (number === 0) return 'green';
        return RouletteGame.RED_NUMBERS.includes(number) ? 'red' : 'black';
    }

    /**
     * Spins the wheel and picks a random winning number.
     * @returns {{number: number, color: string}}
     */
    spin() {
        this.winningNumber = Math.floor(Math.random() * 37);
        this.winningColor = RouletteGame.getColor(this.winningNumber);
        this.spun = true;
        return { number: this.winningNumber, color: this.winningColor };
    }

    /**
     * Payout multipliers for each supported bet type.
     * @returns {Object<string, number>}
     */
    static get PAYOUTS() {
        return {
            straight: 35,
            red: 1,
            black: 1,
            green: 17,
            even: 1,
            odd: 1,
            '1-18': 1,
            '19-36': 1,
            '1-12': 2,
            '13-24': 2,
            '25-36': 2,
            'first-12': 2,
            'second-12': 2,
            'third-12': 2,
            'first-column': 2,
            'second-column': 2,
            'third-column': 2,
            'first-dozen': 2,
            'second-dozen': 2,
            'third-dozen': 2
        };
    }

    /**
     * Validates a bet type and (where applicable) its value.
     * @param {string} betType
     * @param {*} betValue
     * @returns {{valid: boolean, error?: string}}
     */
    static validateBet(betType, betValue) {
        const validTypes = Object.keys(RouletteGame.PAYOUTS);
        if (!validTypes.includes(betType)) {
            return { valid: false, error: `Invalid bet type. Valid types: ${validTypes.join(', ')}` };
        }

        switch (betType) {
            case 'straight':
                if (typeof betValue !== 'number' || !Number.isInteger(betValue) || betValue < 0 || betValue > 36) {
                    return { valid: false, error: 'Straight bet requires a number between 0 and 36.' };
                }
                break;
            case 'red':
            case 'black':
            case 'green':
            case 'even':
            case 'odd':
            case '1-18':
            case '19-36':
            case 'first-12':
            case 'second-12':
            case 'third-12':
            case 'first-column':
            case 'second-column':
            case 'third-column':
            case 'first-dozen':
            case 'second-dozen':
            case 'third-dozen':
            case '1-12':
            case '13-24':
            case '25-36':
                // These bet types take no value.
                break;
            default:
                return { valid: false, error: `Unknown bet type: ${betType}` };
        }

        return { valid: true };
    }

    /**
     * Determines whether a bet wins given the current winning number.
     * @param {string} betType
     * @param {*} betValue
     * @returns {boolean}
     */
    isWinningBet(betType, betValue) {
        if (!this.spun) {
            throw new Error('Cannot resolve bet before the wheel has been spun.');
        }
        const n = this.winningNumber;

        switch (betType) {
            case 'straight':
                return n === betValue;
            case 'red':
                return this.winningColor === 'red';
            case 'black':
                return this.winningColor === 'black';
            case 'green':
                return this.winningColor === 'green';
            case 'even':
                return n !== 0 && n % 2 === 0;
            case 'odd':
                return n !== 0 && n % 2 === 1;
            case '1-18':
                return n >= 1 && n <= 18;
            case '19-36':
                return n >= 19 && n <= 36;
            case '1-12':
            case 'first-12':
            case 'first-dozen':
                return n >= 1 && n <= 12;
            case '13-24':
            case 'second-12':
            case 'second-dozen':
                return n >= 13 && n <= 24;
            case '25-36':
            case 'third-12':
            case 'third-dozen':
                return n >= 25 && n <= 36;
            case 'first-column':
                return n >= 1 && n <= 36 && (n - 1) % 3 === 0;
            case 'second-column':
                return n >= 1 && n <= 36 && (n - 1) % 3 === 1;
            case 'third-column':
                return n >= 1 && n <= 36 && (n - 1) % 3 === 2;
            default:
                return false;
        }
    }

    /**
     * Resolves a bet and returns the payout multiplier.
     * @param {string} betType
     * @param {*} betValue
     * @returns {{win: boolean, payout: number}}
     */
    resolveBet(betType, betValue) {
        const validation = RouletteGame.validateBet(betType, betValue);
        if (!validation.valid) {
            throw new Error(validation.error);
        }
        const win = this.isWinningBet(betType, betValue);
        const payout = win ? RouletteGame.PAYOUTS[betType] : 0;
        return { win, payout };
    }

    /**
     * Returns a human-readable description of the winning result.
     * @returns {string}
     */
    getResultDescription() {
        if (!this.spun) {
            return 'The wheel has not been spun yet.';
        }
        return `Winning number: ${this.winningNumber} (${this.winningColor})`;
    }
}

module.exports = RouletteGame;
