'use strict';

// Verification that the Crate System (config + BalanceManager methods) works.
require('dotenv').config();
const mongoose = require('mongoose');
const BalanceManager = require('../games/balancemanager');
const crates = require('../games/crates');

let pass = 0;
let fail = 0;
function assert(condition, message) {
    if (condition) { pass++; console.log('  PASS: ' + message); }
    else { fail++; console.error('  FAIL: ' + message); }
}

async function runTests() {
    await mongoose.connect(process.env.DATABASE_URL);
    const bm = new BalanceManager();
    const User = require('../models/User');
    const userId = 'test-crates-user';

    // Clean slate
    await User.deleteMany({ userId });

    // 1. Config sanity
    assert(crates.RARITY_ORDER.length === 6, '6 crate rarities defined');
    var dropSum = crates.RARITY_ORDER.reduce(function(sum, key) { return sum + crates.RARITIES[key].dropRate; }, 0);
    assert(Math.abs(dropSum - 1) < 1e-9, 'Drop rates sum to 1 (' + dropSum + ')');

    // 2. rollCrateRarity always returns a valid rarity
    var validRoll = true;
    for (var i = 0; i < 2000; i++) {
        var key = crates.rollCrateRarity();
        if (!crates.RARITIES[key]) { validRoll = false; break; }
    }
    assert(validRoll, 'rollCrateRarity returns a valid rarity on every roll');

    // 3. randomReward stays within each rarity's inclusive range
    var rangesOk = true;
    for (const rkey of crates.RARITY_ORDER) {
        var r = crates.RARITIES[rkey];
        for (var j = 0; j < 500; j++) {
            var reward = crates.randomReward(rkey);
            if (reward < r.min || reward > r.max) { rangesOk = false; break; }
        }
        if (!rangesOk) break;
    }
    assert(rangesOk, 'randomReward always within configured ranges');

    // 4. New user has zero crates
    var empty = await bm.getCrates(userId);
    assert(empty.common === 0 && empty.mythic === 0, 'New user has zero crates');

    // 5. grantCrate increments the correct rarity
    await bm.grantCrate(userId, 'common');
    await bm.grantCrate(userId, 'mythic');
    var afterGrant = await bm.getCrates(userId);
    assert(afterGrant.common === 1, 'grantCrate increments common (' + afterGrant.common + ')');
    assert(afterGrant.mythic === 1, 'grantCrate increments mythic (' + afterGrant.mythic + ')');

    // 6. openCrate deducts one crate and credits a reward
    var balBefore = await bm.getBalance(userId);
    var opened = await bm.openCrate(userId, 'common');
    assert(opened.success === true, 'openCrate succeeds');
    assert(opened.reward >= 299 && opened.reward <= 999, 'common reward in range (' + opened.reward + ')');
    assert(opened.balance === balBefore + opened.reward, 'balance credited with reward');
    assert(opened.remaining === 0, 'common crate deducted (remaining 0)');

    // 7. Opening a rarity you don't own fails
    var noCrates = await bm.openCrate(userId, 'common');
    assert(noCrates.success === false && noCrates.error === 'NO_CRATES', 'openCrate fails when no crates of that rarity');

    // 8. Unknown rarity is rejected
    var invalid = await bm.openCrate(userId, 'notreal');
    assert(invalid.success === false && invalid.error === 'INVALID_RARITY', 'openCrate rejects invalid rarity');

    // 9. Mythic reward range
    var openedMythic = await bm.openCrate(userId, 'mythic');
    assert(openedMythic.success === true, 'openCrate mythic succeeds');
    assert(openedMythic.reward >= 15000 && openedMythic.reward <= 30000, 'mythic reward in range (' + openedMythic.reward + ')');

    // Clean up
    await User.deleteMany({ userId });
    await mongoose.disconnect();

    console.log('');
    console.log('=== Crate System Test Summary ===');
    console.log('Passed: ' + pass + ', Failed: ' + fail);
    if (fail > 0) { process.exit(1); } else { console.log('PASS: All crate tests passed!'); }
}

runTests().catch(err => { console.error('TEST ERROR:', err); process.exit(1); });
