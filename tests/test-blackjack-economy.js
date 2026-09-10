'use strict';

/**
 * Regression test: Blackjack economy (bet deduction + payout rules).
 * Verifies the Draw/Push payout returns EXACTLY the original bet (net zero),
 * and never double-pays.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BlackjackGame = require('../games/blackjackgame');
const BalanceManager = require('../games/balancemanager');
const User = require('../models/User');

const { applyPayout } = require('../src/commands/blackjack');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  PASS: ' + msg); }
    else { fail++; console.error('  FAIL: ' + msg); }
}

const BET = 1000;

/**
 * Runs a full economy cycle: fresh balance → deduct bet → force outcome →
 * applyPayout. Returns the net balance change.
 */
async function runScenario(outcome, setupGame) {
    const bm = new BalanceManager();
    const uid = 'eco-user-' + outcome;

    // Clean slate
    await User.deleteOne({ userId: uid });

    const start = await bm.getBalance(uid); // 1000 starter
    await bm.updateBalance(uid, 5000);      // fund above bankruptcy threshold
    const funded = await bm.getBalance(uid);

    const g = new BlackjackGame();
    // A randomly-dealt natural blackjack ends the round inside startRound()
    // (gameOver = true), which would make later setupGame() calls like
    // g.stand() throw. Redeal until the round is genuinely live.
    let round = g.startRound(BET);
    while (round.blackjack) {
        round = g.startRound(BET);
    }
    await bm.updateBalance(uid, funded - BET); // deduct like execute()

    setupGame(g);

    const after = await applyPayout(g, uid, bm);
    await User.deleteOne({ userId: uid });

    return { net: after.balance - funded, balance: after.balance };
}

(async () => {
    await mongoose.connect(process.env.DATABASE_URL);

    console.log('=== Blackjack Economy / Push Payout Tests ===\n');

    // 1) PUSH — the critical fix: return exactly the bet, net zero.
    const push = await runScenario('push', g => {
        g.playerHand = ['10\u2660', 'K\u2665'];   // 20
        g.dealerHand = ['10\u2666', 'Q\u2663'];  // 20
        g.stand(); // forces an exact 20–20 tie
    });
    assert(push.net === 0, 'PUSH: net balance change is exactly 0 (got ' + push.net + ')');

    // Deterministic push (hand-crafted outcome)
    const push2 = await runScenario('push2', g => {
        g.gameOver = true;
        g.outcome = 'push';
    });
    assert(push2.net === 0, 'PUSH (deterministic): net change is 0, NOT +' + BET);

    // 2) WIN — bet back + even-money profit.
    const win = await runScenario('win', g => {
        g.gameOver = true;
        g.outcome = 'win';
    });
    assert(win.net === BET, 'WIN: net change is +' + BET + ' (got ' + win.net + ')');

    // 3) BLACKJACK — 3:2 payout.
    const bj = await runScenario('blackjack', g => {
        g.gameOver = true;
        g.outcome = 'blackjack';
    });
    assert(bj.net === Math.round(BET * 1.5), 'BLACKJACK: net change is +' + Math.round(BET * 1.5) + ' (got ' + bj.net + ')');

    // 4) LOSE — nothing returned.
    const lose = await runScenario('lose', g => {
        g.gameOver = true;
        g.outcome = 'lose';
    });
    assert(lose.net === -BET, 'LOSE: net change is -' + BET + ' (got ' + lose.net + ')');

    // 5) SURRENDER — half bet back.
    const sur = await runScenario('surrender', g => {
        g.gameOver = true;
        g.outcome = 'surrender';
    });
    assert(sur.net === -Math.round(BET * 0.5), 'SURRENDER: net change is -' + Math.round(BET * 0.5) + ' (got ' + sur.net + ')');

    await mongoose.disconnect();

    console.log('\n=== Test Summary ===');
    console.log('Passed: ' + pass + ', Failed: ' + fail);
    process.exit(fail > 0 ? 1 : 0);
})();