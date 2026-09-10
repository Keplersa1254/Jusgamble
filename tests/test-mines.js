'use strict';

const { MinesweeperEngine, DIFFICULTY } = require('../src/logic/minesweeperEngine');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  PASS: ' + msg); }
    else { fail++; console.error('  FAIL: ' + msg); }
}

console.log('=== Casino Mines Engine Tests (v5 - no flags, direct reveal) ===\n');

function testProgression(diff, expected) {
    const g = new MinesweeperEngine(diff);
    g.minesPlaced = true;
    for (let i = 0; i < expected.length; i++) {
        g.revealed.clear();
        for (let j = 0; j < i + 1; j++) g.revealed.add(MinesweeperEngine.key(0, j));
        assert(g.currentMultiplier === expected[i],
            diff + ' tile ' + (i + 1) + ' = ' + expected[i] + 'x (got ' + g.currentMultiplier + 'x)');
    }
}

testProgression('easy',   [0.70, 0.90, 1.10, 1.30]);
testProgression('medium', [0.70, 1.00, 1.30, 1.60]);
testProgression('hard',   [0.70, 1.10, 1.50, 1.90]);

// Formula check
const hf = new MinesweeperEngine('hard');
hf.minesPlaced = true;
hf.revealed.add('0,0'); // 1 gem → 0.70
assert(hf.currentMultiplier === 0.70, 'hard: 1 gem = 0.70');
hf.revealed.add('0,1'); // 2 gems → 1.10
assert(hf.currentMultiplier === 1.10, 'hard: 2 gems = 1.10 (0.70 + 0.40*(2-1))');
hf.revealed.add('0,2'); // 3 gems → 1.50
assert(hf.currentMultiplier === 1.50, 'hard: 3 gems = 1.50');
assert(hf.nextMultiplier === 1.90, 'hard nextMultiplier: 4 gems = 1.90');
assert(hf.breakEvenAt === 2, 'hard break-even at 2 gems');

const ef = new MinesweeperEngine('easy');
ef.minesPlaced = true;
ef.revealed.add('0,0');
assert(ef.breakEvenAt === 3, 'easy break-even at 3 gems');

const mf = new MinesweeperEngine('medium');
mf.minesPlaced = true;
mf.revealed.add('0,0');
assert(mf.breakEvenAt === 2, 'medium break-even at 2 gems');

// Metadata
assert(DIFFICULTY.easy.mines === 3 && DIFFICULTY.easy.increment === 0.20, 'easy: 3 mines, +0.20');
assert(DIFFICULTY.medium.mines === 5 && DIFFICULTY.medium.increment === 0.30, 'medium: 5 mines, +0.30');
assert(DIFFICULTY.hard.mines === 8 && DIFFICULTY.hard.increment === 0.40, 'hard: 8 mines, +0.40');

// First-click safety
const safe = new MinesweeperEngine('hard');
safe.reveal(0, 0);
assert(safe.status === 'playing' && safe.minesPlaced, 'first click safety works');

// Forfeit & cashout paths
const fr = new MinesweeperEngine('medium');
fr.placeMines(0, 0);
fr.reveal(0, 0);
fr.status = 'lost';
assert(fr.status === 'lost', 'forfeit sets lost status');

const co = new MinesweeperEngine('easy');
co.placeMines(0, 0);
co.reveal(1, 1);
co.cashout();
let coins = 0;
for (const mine of co.mines) if (co.revealed.has(mine)) coins++;
assert(coins === co.mines.size, 'cashout reveals all mines');

console.log('\n=== Test Summary ===');
console.log('Passed: ' + pass + ', Failed: ' + fail);
process.exit(fail > 0 ? 1 : 0);
