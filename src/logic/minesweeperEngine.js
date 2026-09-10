'use strict';

/**
 * Casino Mines game engine — no Discord dependencies.
 *
 * Grid: 4 rows × 5 columns (20 cells) — the maximum that fits alongside a
 * control row within Discord's 5-action-row limit.
 */

const ROWS = 4;
const COLS = 5;
const TOTAL_CELLS = ROWS * COLS;

/** Cell emojis used for board rendering. */
const EMOJI = {
    hidden: '⬛',
    safe: '💎',
    mine: '💥'
};

/**
 * Difficulty presets: mine count + linear multiplier increment per safe gem.
 *
 * Starting multiplier is always 0.70x (after the first safe click).
 * Each subsequent revealed gem adds the difficulty's increment.
 *
 *   Easy:   0.70x  →  0.90x  →  1.10x  →  1.30x  →  … (+0.20x/gem)
 *   Medium: 0.70x  →  1.00x  →  1.30x  →  1.60x  →  … (+0.30x/gem)
 *   Hard:   0.70x  →  1.10x  →  1.50x  →  1.90x  →  … (+0.40x/gem)
 */
const DIFFICULTY = {
    easy:  { mines: 3,  label: '🟢 Easy',   increment: 0.20 },
    medium:{ mines: 5,  label: '🟡 Medium', increment: 0.30 },
    hard:  { mines: 8,  label: '🔴 Hard',   increment: 0.40 }
};

const BASE_MULTIPLIER = 0.70;

class MinesweeperEngine {
    /**
     * @param {string} difficulty One of 'easy', 'medium', 'hard'.
     */
    constructor(difficulty = 'medium') {
        const preset = DIFFICULTY[difficulty] || DIFFICULTY.medium;
        this.difficulty = difficulty;
        this.rows = ROWS;
        this.cols = COLS;
        this.mineCount = preset.mines;
        this.multiplierIncrement = preset.increment;
        this.diffLabel = preset.label;

        this.mines = new Set();
        this.revealed = new Set();

        this.explodedAt = null;
        this.minesPlaced = false;
        this.status = 'playing'; // 'playing' | 'won' | 'lost' | 'cashed_out'
    }

    static key(r, c) { return `${r},${c}`; }

    inBounds(r, c) {
        return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
    }

    neighbors(r, c) {
        const out = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr;
                const nc = c + dc;
                if (this.inBounds(nr, nc)) out.push([nr, nc]);
            }
        }
        return out;
    }

    /** First-click safety: exclude the clicked cell AND its neighbors. */
    placeMines(safeR, safeC) {
        if (this.minesPlaced) return;

        const forbidden = new Set([MinesweeperEngine.key(safeR, safeC)]);
        for (const [nr, nc] of this.neighbors(safeR, safeC)) {
            forbidden.add(MinesweeperEngine.key(nr, nc));
        }

        const candidates = [];
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const k = MinesweeperEngine.key(r, c);
                if (!forbidden.has(k)) candidates.push(k);
            }
        }

        // Fisher-Yates
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        const count = Math.min(this.mineCount, candidates.length);
        for (let i = 0; i < count; i++) this.mines.add(candidates[i]);
        this.minesPlaced = true;
    }

    /** Reveal one cell. In casino mines there is no flood-fill — each tap is a deliberate pick. */
    reveal(r, c) {
        if (this.status !== 'playing') return;
        if (!this.inBounds(r, c)) return;

        const key = MinesweeperEngine.key(r, c);
        if (this.revealed.has(key)) return;

        if (!this.minesPlaced) this.placeMines(r, c);

        if (this.mines.has(key)) {
            this.explodedAt = key;
            this.status = 'lost';
            for (const mine of this.mines) this.revealed.add(mine);
            return;
        }

        this.revealed.add(key);
        if (this._allSafeRevealed()) this.status = 'won';
    }

    /** Player cashes out — collects current multiplier. */
    cashout() {
        if (this.status !== 'playing') return;
        this.status = 'cashed_out';
        // Reveal all mines so player can see where they were
        for (const mine of this.mines) this.revealed.add(mine);
    }

    /** How many safe (non-mine) cells have been revealed. */
    get gemsFound() {
        let count = 0;
        for (const k of this.revealed) {
            if (!this.mines.has(k)) count++;
        }
        return count;
    }

    /** Current payout multiplier: 0.70 + increment × max(0, gemsFound - 1). */
    get currentMultiplier() {
        const bonus = Math.max(0, this.gemsFound - 1);
        return +(BASE_MULTIPLIER + this.multiplierIncrement * bonus).toFixed(2);
    }

    /** Multiplier after the next safe reveal. */
    get nextMultiplier() {
        const nextGems = Math.max(0, this.gemsFound + 1);
        const bonus = Math.max(0, nextGems - 1);
        return +(BASE_MULTIPLIER + this.multiplierIncrement * bonus).toFixed(2);
    }

    /** Break-even point: number of gems needed to reach ≥1.00x. */
    get breakEvenAt() {
        // Use scaled integer math to avoid JS floating-point quirks (0.30/0.30 = 1.0000000000000002).
        const gap = Math.round((1.00 - BASE_MULTIPLIER) * 100);
        const step = Math.round(this.multiplierIncrement * 100);
        const extra = Math.ceil(gap / step);
        return 1 + extra; // first gem doesn't count
    }

    /** How many safe cells remain. */
    get safeRemaining() {
        return (TOTAL_CELLS - this.mineCount) - this.gemsFound;
    }

    _allSafeRevealed() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const k = MinesweeperEngine.key(r, c);
                if (!this.mines.has(k) && !this.revealed.has(k)) return false;
            }
        }
        return true;
    }

    cellEmoji(r, c) {
        const key = MinesweeperEngine.key(r, c);
        if (this.revealed.has(key)) {
            return this.mines.has(key) ? EMOJI.mine : EMOJI.safe;
        }
        return EMOJI.hidden;
    }
}

module.exports = { MinesweeperEngine, DIFFICULTY, EMOJI, ROWS, COLS, TOTAL_CELLS };
