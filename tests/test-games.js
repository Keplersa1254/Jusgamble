'use strict';

const RouletteGame = require('../games/roulettegame');
const BlackjackGame = require('../games/blackjackgame');

let pass = 0;
let fail = 0;

function assert(condition, message) {
    if (condition) { pass++; console.log('  PASS: ' + message); }
    else { fail++; console.error('  FAIL: ' + message); }
}

console.log('\n=== RouletteGame Tests ===\n');

// Color lookup
assert(RouletteGame.getColor(0) === 'green', 'Color of 0 is green');
assert(RouletteGame.getColor(17) === 'black', 'Color of 17 is black');
assert(RouletteGame.getColor(18) === 'red', 'Color of 18 is red');
assert(RouletteGame.getColor(36) === 'red', 'Color of 36 is red');
assert(RouletteGame.getColor(2) === 'black', 'Color of 2 is black');

// Spin
const rg = new RouletteGame();
const spinResult = rg.spin();
assert(typeof spinResult.number === 'number', 'Spin returns a number');
assert(spinResult.number >= 0 && spinResult.number <= 36, 'Spin number in range 0-36');
assert(['red','black','green'].includes(spinResult.color), 'Spin color is valid');

// Bet resolution
const rg2 = new RouletteGame();
rg2.spin();
const res = rg2.resolveBet('straight', 17);
assert(typeof res.win === 'boolean', 'resolveBet returns win boolean');
assert(typeof res.payout === 'number', 'resolveBet returns payout number');

// Statistics: red bet ~48.65%
let redWins = 0;
for (let i = 0; i < 10000; i++) {
    const g = new RouletteGame();
    g.spin();
    if (g.resolveBet('red', null).win) redWins++;
}
const redWinRate = redWins / 10000;
assert(redWinRate > 0.46 && redWinRate < 0.51, 'Red bet win rate ~48.6% (' + (redWinRate * 100).toFixed(1) + '%)');

// Statistics: straight bet ~2.7%
let straightWins = 0;
for (let i = 0; i < 10000; i++) {
    const g = new RouletteGame();
    g.spin();
    if (g.resolveBet('straight', 17).win) straightWins++;
}
const straightWinRate = straightWins / 10000;
assert(straightWinRate > 0.02 && straightWinRate < 0.04, 'Straight bet win rate ~2.7% (' + (straightWinRate * 100).toFixed(1) + '%)');

// Payout multipliers
assert(RouletteGame.PAYOUTS.straight === 35, 'Straight payout is 35');
assert(RouletteGame.PAYOUTS.red === 1, 'Red payout is 1');
assert(RouletteGame.PAYOUTS['1-12'] === 2, 'Dozen payout is 2');

// Validation
assert(RouletteGame.validateBet('straight', 17).valid === true, 'Validate straight(17) valid');
assert(RouletteGame.validateBet('straight', 37).valid === false, 'Validate straight(37) invalid');
assert(RouletteGame.validateBet('straight', -1).valid === false, 'Validate straight(-1) invalid');
assert(RouletteGame.validateBet('red', null).valid === true, 'Validate red(null) valid');
assert(RouletteGame.validateBet('invalid', null).valid === false, 'Validate invalid bet type');

// Error before spin
const rg3 = new RouletteGame();
let threw = false;
try { rg3.resolveBet('red', null); } catch (e) { threw = true; }
assert(threw, 'resolveBet throws before spin');

console.log('\n=== BlackjackGame Tests ===\n');

// Hand value (use Unicode suit chars)
assert(BlackjackGame.handValue(['A\u2660', 'K\u2665']) === 21, 'Hand value [A,K] = 21');
assert(BlackjackGame.handValue(['A\u2660', 'A\u2665', '9\u2662']) === 21, 'Hand value [A,A,9] = 21');
assert(BlackjackGame.handValue(['A\u2660', 'A\u2665', 'A\u2662', 'A\u2663', '10\u2660']) === 14, 'Hand value [A,A,A,A,10] = 14');
assert(BlackjackGame.handValue(['10\u2660', '5\u2665', '7\u2662']) === 22, 'Hand value [10,5,7] = 22 (bust)');
assert(BlackjackGame.handValue(['10\u2660', '6\u2665', '5\u2662']) === 21, 'Hand value [10,6,5] = 21');

// Is blackjack
assert(BlackjackGame.isBlackjack(['A\u2660', 'K\u2665']) === true, 'Is blackjack [A,K]');
assert(BlackjackGame.isBlackjack(['A\u2660', '5\u2665']) === false, 'Not blackjack [A,5]');
assert(BlackjackGame.isBlackjack(['10\u2660', '6\u2665', '5\u2662']) === false, 'Not blackjack [10,6,5] at 21');

// Card value
assert(BlackjackGame.cardValue('A\u2660') === 11, 'Card value A = 11');
assert(BlackjackGame.cardValue('K\u2665') === 10, 'Card value K = 10');
assert(BlackjackGame.cardValue('5\u2662') === 5, 'Card value 5 = 5');
assert(BlackjackGame.cardValue('10\u2663') === 10, 'Card value 10 = 10');

// Deck creation
const deck = BlackjackGame.createDeck();
assert(deck.length === 52, 'Deck has 52 cards (' + deck.length + ')');

// Shuffle
const unshuffled = BlackjackGame.createDeck();
const shuffled = BlackjackGame.shuffle([...unshuffled]);
assert(shuffled.length === 52, 'Shuffled deck has 52 cards');
let different2 = false;
for (let i = 0; i < 52; i++) {
    if (shuffled[i] !== unshuffled[i]) { different2 = true; break; }
}
assert(different2, 'Shuffle changes order');

// Start round
const bg = new BlackjackGame();
const round = bg.startRound(100);
assert(round.playerHand.length === 2, 'Player starts with 2 cards');
assert(round.dealerHand.length === 2, 'Dealer starts with 2 cards');
assert(round.playerValue >= 4 && round.playerValue <= 21, 'Player value valid (' + round.playerValue + ')');
assert(round.dealerValue >= 4 && round.dealerValue <= 21, 'Dealer value valid (' + round.dealerValue + ')');
assert(round.blackjack === BlackjackGame.isBlackjack(round.playerHand), 'Blackjack flag matches');

// Payout before end. NOTE: if the randomly-dealt starting hand is a natural
// blackjack, startRound() marks the game over instantly, so the multiplier is
// already 2.5 rather than 0. Only assert 0 when the round is genuinely live.
if (!round.blackjack) {
    assert(bg.getPayoutMultiplier() === 0, 'Payout multiplier is 0 before game ends');
}

// Surrender
const bg2 = new BlackjackGame();
// Redeal if the random opening hand was a natural blackjack (the round would
// already be over and surrender() would throw "The game is already over.").
while (bg2.startRound(100).blackjack) { /* redeal */ }
const sr = bg2.surrender();
assert(sr.outcome === 'surrender', 'Surrender works');
assert(bg2.getPayoutMultiplier() === 0.5, 'Surrender payout multiplier is 0.5');

// Double down only on 2 cards
const bg3 = new BlackjackGame();
while (bg3.startRound(100).blackjack) { /* redeal */ }
bg3.hit();
let ddError = false;
try { bg3.doubleDown(); } catch (e) { ddError = true; }
assert(ddError, 'Double down throws after hit');

// Double down on initial
const bg4 = new BlackjackGame();
while (bg4.startRound(100).blackjack) { /* redeal */ }
bg4.doubleDown();
assert(bg4.gameOver === true, 'Double down ends game');
assert(bg4.bet === 200, 'Double down doubles bet');

// Simulate a realistic strategy: hit until 17+, then stand
// Outcomes should only be win/lose/push (no bust since we stop at 17+)
let outcomes = { win: 0, lose: 0, push: 0, bust: 0, blackjack: 0 };
for (let i = 0; i < 5000; i++) {
    const bj = new BlackjackGame();
    bj.startRound(100);
    // If natural blackjack, game is already over
    if (!bj.gameOver) {
        // Hit until 17 or more
        while (BlackjackGame.handValue(bj.playerHand) < 17 && !bj.gameOver) {
            try { bj.hit(); } catch (e) { break; }
        }
        // If not bust, stand
        if (!bj.gameOver) {
            bj.stand();
        }
    }
    outcomes[bj.outcome] = (outcomes[bj.outcome] || 0) + 1;
}
const totalOutcomes = outcomes.win + outcomes.lose + outcomes.push + outcomes.bust + outcomes.blackjack;
assert(totalOutcomes === 5000, 'All 5000 simulated games produced an outcome');
assert(outcomes.win + outcomes.lose + outcomes.push + outcomes.bust + outcomes.blackjack === 5000, 'All outcomes accounted for');
assert(outcomes.win > 0, 'Player wins some games');
assert(outcomes.lose > 0, 'Player loses some games');
assert(outcomes.push > 0, 'Some games push');
console.log('  Simulated 5000 games (hit to 17+): win=' + outcomes.win + ' lose=' + outcomes.lose +
    ' push=' + outcomes.push + ' bust=' + outcomes.bust + ' bj=' + outcomes.blackjack);

// Dealer 17+ after stand (retry if natural blackjack was dealt)
const bg5 = new BlackjackGame();
let round5 = bg5.startRound(100);
while (round5.blackjack) {
    round5 = bg5.startRound(100);
}
bg5.stand();
assert(BlackjackGame.handValue(bg5.dealerHand) >= 17, 'Dealer 17+ after stand');
assert(bg5.gameOver === true, 'Game over after stand');
assert(['win','lose','push'].includes(bg5.outcome), 'Outcome valid after stand (' + bg5.outcome + ')');

console.log('\n=== Test Summary ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);
if (fail > 0) {
    console.error('FAIL: Some tests failed!');
    process.exit(1);
} else {
    console.log('PASS: All tests passed!');
}



