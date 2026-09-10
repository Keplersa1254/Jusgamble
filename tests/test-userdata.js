'use strict';

/**
 * Tests for the Mongoose user data system (games/userdata.js) that tracks
 * Discord users' progress (XP/level, games, wins/losses, wagers) in MongoDB.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

let pass = 0;
let fail = 0;
function assert(condition, message) {
    if (condition) { pass++; console.log('  PASS: ' + message); }
    else { fail++; console.error('  FAIL: ' + message); }
}

(async () => {
    await mongoose.connect(process.env.DATABASE_URL);
    const ud = require('../games/userdata');

    console.log('=== Usage / Game tracking ===');

    // Clean slate
    await User.deleteOne({ userId: 'ud-user' });

    // Two commands: 1 non-game (5xp), 1 game (5xp + 10 bonus = 15xp)
    await ud.recordUsage('ud-user', 'balance');
    await ud.recordUsage('ud-user', 'blackjack');
    // One finished game outcome (+10xp)
    await ud.recordGameResult('ud-user', 'blackjack', 'win', 500);

    let p = await ud.getProfile('ud-user');
    assert(p.totalGamesPlayed === 1, 'totalGamesPlayed = 1 (got ' + p.totalGamesPlayed + ')');
    assert(p.xp === 30, 'xp = 30 (got ' + p.xp + ')');
    assert((p.games && p.games.blackjack && p.games.blackjack.wins) === 1, 'blackjack win recorded');
    assert((p.games && p.games.blackjack && p.games.blackjack.wagers) === 500, 'blackjack wager recorded');
    assert(p.totalWagered === 500, 'totalWagered = 500 (got ' + p.totalWagered + ')');

    // A loss
    await ud.recordGameResult('ud-user', 'blackjack', 'loss', 100);
    p = await ud.getProfile('ud-user');
    assert(p.totalWins === 1 && p.totalLosses === 1, '1 win / 1 loss');

    console.log('\n=== Persistence ===');
    const p2 = await ud.getProfile('ud-user');
    assert(p2.xp === p.xp, 'stats persist across reads');

    console.log('\n=== Level curve ===');
    assert(ud.xpForLevel(1) === 0 && ud.xpForLevel(2) === 50, 'xpForLevel(1)=0, (2)=50');
    assert(ud.xpForLevel(4) === 300, 'xpForLevel(4)=300 (got ' + ud.xpForLevel(4) + ')');
    assert(ud.levelFromXp(0) === 1 && ud.levelFromXp(49) === 1, 'levelFromXp under 50 = 1');
    assert(ud.levelFromXp(50) === 2 && ud.levelFromXp(300) === 4, 'levelFromXp 50→2, 300→4');

    // Clean up
    await User.deleteOne({ userId: 'ud-user' });
    await mongoose.disconnect();

    console.log('\n=== Test Summary ===');
    console.log('Passed: ' + pass + ', Failed: ' + fail);
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => { console.error('TEST ERROR:', err); process.exit(1); });