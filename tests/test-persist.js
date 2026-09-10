'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const BlackjackGame = require('../games/blackjackgame');
const store = require('../games/blackjackstore');
const BlackjackGameModel = require('../models/BlackjackGame');
const { randomUUID } = require('crypto');

(async () => {
    await mongoose.connect(process.env.DATABASE_URL);
    await store.ready;

    const userId = 'test-user-123';
    const gameId = randomUUID();

    // Clean slate
    await BlackjackGameModel.deleteOne({ gameId });

    const game = new BlackjackGame();
    const round = game.startRound(100);
    console.log('started game, blackjack?', round.blackjack);

    // Save like execute() does.
    await store.save(gameId, { userId, ...game.toState() });

    // Simulate a bot restart: look the game back up and rebuild.
    const entry = await store.get(gameId);
    if (!entry) throw new Error('FAIL: game not found after save');
    console.log('loaded game for user', entry.userId, '| bet', entry.bet, '| hand', entry.playerHand.join(' '));

    const rebuilt = BlackjackGame.fromState(entry);
    console.log('rebuilt hand value', BlackjackGame.handValue(rebuilt.playerHand), '| gameOver', rebuilt.gameOver);

    // Act on the rebuilt game: hit if comfortable, then stand if still going.
    if (rebuilt.gameOver) {
        console.log('round already over (natural blackjack), outcome', rebuilt.outcome);
    } else {
        if (BlackjackGame.handValue(rebuilt.playerHand) < 17) rebuilt.hit();
        if (rebuilt.gameOver) {
            console.log('busted after hit: outcome', rebuilt.outcome);
        } else {
            rebuilt.stand();
            console.log('after action: outcome', rebuilt.outcome, '| multiplier', rebuilt.getPayoutMultiplier());
        }
    }

    // Save updated state (like the button handler does after an action).
    await store.save(gameId, { userId, ...rebuilt.toState() });
    const updated = await store.get(gameId);
    console.log('updated persisted outcome', updated.outcome, '| bet', updated.bet);

    // Cleanup and verify removal.
    await store.remove(gameId);
    const gone = await store.get(gameId);
    console.log('removed?', gone === null);
    console.log('active games for user after cleanup?', await store.userHasActiveGame(userId));

    await BlackjackGameModel.deleteOne({ gameId });
    await mongoose.disconnect();

    console.log('\n=== ALL STORE ROUND-TRIP TESTS PASSED ===');
})().catch(e => {
    console.error('TEST FAILED:', e);
    process.exit(1);
});