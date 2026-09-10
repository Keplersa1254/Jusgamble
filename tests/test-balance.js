'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const BalanceManager = require('../games/balancemanager');

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
    const userId = 'test-user-1';

    // Clean slate
    await User.deleteMany({ userId: { $in: [userId, 'user-2'] } });

    // 1. New user starts with 1000
    const bal = await bm.getBalance(userId);
    assert(bal === 1000, 'New user starts with 1000 (' + bal + ')');

    // 2. Persistence - new manager reading same user
    const bm2 = new BalanceManager();
    const bal2 = await bm2.getBalance(userId);
    assert(bal2 === 1000, 'Balance persists across instances (' + bal2 + ')');

    // 3. Update balance
    const r1 = await bm2.updateBalance(userId, 500);
    assert(r1.balance === 500, 'Set balance to 500');
    const balAfter = await bm2.getBalance(userId);
    assert(balAfter === 500, 'Read back updated balance (' + balAfter + ')');

    // 4. No bankruptcy refill — low balance stays low
    const r2 = await bm2.updateBalance(userId, 20);
    assert(r2.balance === 20, 'Low balance stays (no auto-refill to 1000)');

    // 5. Daily bonus (first claim = streak 1 = 1000 chips)
    const d1 = await bm2.claimDaily(userId);
    assert(d1.claimed === true, 'First daily claim succeeds');
    assert(d1.amount === 1000, 'First daily = 1000 chips (streak 1 base) — got ' + d1.amount);
    assert(d1.streak === 1, 'Streak starts at 1 — got ' + d1.streak);
    assert(d1.balance === 1020, 'Balance 20 + 1000 = 1020 — got ' + d1.balance);

    // 6. Daily cooldown
    const d2 = await bm2.claimDaily(userId);
    assert(d2.claimed === false, 'Daily bonus has 24h cooldown');

    // 7. canAfford
    const aff1 = await bm2.canAfford(userId, 100);
    const aff2 = await bm2.canAfford(userId, 5000);
    assert(aff1.canAfford === true, 'Can afford 100');
    assert(aff2.canAfford === false, 'Cannot afford 5000');

    // 8. Transfer
    const other = 'user-2';
    const t = await bm2.transfer(userId, other, 100);
    assert(t.success === true, 'Transfer succeeds');
    assert(t.toBalance === 1100, 'Recipient receives 1000 starter + 100 transfer (' + t.toBalance + ')');

    // 9. Insufficient transfer
    const t2 = await bm2.transfer(userId, other, 99999);
    assert(t2.success === false, 'Insufficient transfer fails');

    // 10. Persistence after writes
    const bm3 = new BalanceManager();
    const bal3 = await bm3.getBalance(other);
    assert(bal3 === 1100, 'Transfer persists across reload (' + bal3 + ')');

    // Clean up
    await User.deleteMany({ userId: { $in: [userId, 'user-2'] } });
    await mongoose.disconnect();

    console.log('');
    console.log('=== Balance Manager Test Summary ===');
    console.log('Passed: ' + pass + ', Failed: ' + fail);
    if (fail > 0) { process.exit(1); } else { console.log('PASS: All balance tests passed!'); }
}

runTests().catch(err => { console.error('TEST ERROR:', err); process.exit(1); });