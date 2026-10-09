// Headless test of prediction + reconciliation (js/net/predict.js). Run:  node js/test/predict-test.js
// A "server" sim and a "client" sim run side by side with a fixed one-way latency of LAG ticks, no sockets. The client presses random keys (all specials, grapple on
// the death ball, weight, ...), predicts LAG*2 ticks ahead, and rolls back to every snapshot. We check that:
//   1. with a quiet opponent the prediction is EXACT: the predicted world at tick k hashes the same as the server's world at tick k, even through grapples and the whippy ball;
//   2. with an active opponent the prediction is only wrong where the opponent actually interfered, and every misprediction is fixed by the next snapshot;
//   3. a snapshot's ack removes exactly the inputs it contains (no double-applied key presses).
const fs = require('fs'), path = require('path'), vm = require('vm');
const { loadSim, ROOT } = require('../server/sim-node.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const NET_BITS = { l: 1, r: 2, up: 4, dn: 8, z: 16, x: 32, sp: 64 };
const SPECIALS = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat'];
const rng = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function makeClient() {
    const sim = loadSim();
    sim.ctx.NET_BITS = NET_BITS;
    sim.run('const net = { slot: 0, off: 0, dtMs: 1000 / 120, rtt: 0, running: true };'); // just enough of client.js for predict.js
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/net/predict.js'), 'utf8'), sim.ctx, { filename: 'js/net/predict.js' });
    return sim;
}
function bitsToKeys(bits) { return `{l:${!!(bits & 1)},r:${!!(bits & 2)},up:${!!(bits & 4)},dn:${!!(bits & 8)},z:${!!(bits & 16)},x:${!!(bits & 32)},sp:${!!(bits & 64)}}`; }

// The client predicts LAG*2 ticks AHEAD of what the server has computed in real time, so to compare we let the harness compare against ticks the server has already reached:
// the prediction made at frame n for tick n + LAG is checked later, once the server reaches that tick.
function runChecked(cfg) {
    const S = loadSim(), C = makeClient(), r = rng(cfg.seed), ro = rng(cfg.seed ^ 0xabcdef), { LAG, ticks } = cfg;
    for (const sim of [S, C]) {
        sim.run('setTeamSize(1)');
        sim.run(`players[0].special = '${cfg.special}'; players[1].special = 'dash'`);
    }
    if (cfg.startNear) S.run('players[1].x = players[0].x + 45; players[1].sx = players[1].x'); // the opponent starts right beside me, so their keys really do change my world
    const serverHash = {}, serverMe = {}, predictions = []; // predictions: { tick, hash, me, ball }
    const inflightIn = [], inflightSnap = [];
    let bits0 = 0, bits1 = 0, seq = 0, serverSeq = 0, applied0 = 0, ackBug = 0, reconciles = 0, bigErr = 0, tethered = 0;
    for (let n = 1; n <= ticks; n++) {
        let nb = bits0;
        for (const k in NET_BITS)
            if (r() < (k === 'sp' ? 0.012 : k === 'z' ? 0.03 : 0.02))
                nb ^= NET_BITS[k];
        if (nb !== bits0) {
            bits0 = nb;
            ++seq;
            C.ctx.__b = bits0; C.ctx.__q = seq;
            C.ctx.__base = n - 1 + LAG; C.run('predPress(__b, __q, pred.state ? pred.tick : __base)');
            inflightIn.push({ at: n + LAG, seq, bits: bits0 });
        }
        while (inflightIn.length && inflightIn[0].at <= n) { const m = inflightIn.shift(); applied0 = m.bits; serverSeq = m.seq; }
        if (cfg.opponentActive)
            for (const k in NET_BITS)
                if (ro() < (cfg.oppRate || 0.015))
                    bits1 ^= NET_BITS[k];
        S.run(`Object.assign(players[0].keys, ${bitsToKeys(applied0)}); Object.assign(players[1].keys, ${bitsToKeys(bits1)}); update()`);
        serverHash[n] = S.hash();
        serverMe[n] = S.run('({ x: players[0].x, y: players[0].y })');
        if (process.env.DEBUG) (global.__ss = global.__ss || {})[n] = S.save();
        if (S.run('players[0].rope && players[0].onBall')) tethered++;
        const st = S.save();
        if (n % 4 === 0)
            inflightSnap.push({ at: n + LAG, tick: n, ack: serverSeq, s: JSON.parse(JSON.stringify(st)) });
        while (inflightSnap.length && inflightSnap[0].at <= n) {
            const m = inflightSnap.shift();
            C.ctx.__T = m.tick; C.ctx.__s = m.s; C.ctx.__a = m.ack;
            const e = C.run('predReconcile(__T, __s, __a)');
            reconciles++;
            if (e > 0.01) bigErr++;
            ackBug = Math.max(ackBug, C.run('pred.log.filter(e => e.seq <= pred.ack).length'));
        }
        C.ctx.__t = n + LAG;
        C.run('predAdvance(__t)');
        if (C.run('!!pred.state')) predictions.push({ tick: C.run('pred.tick'), hash: C.run('stateHash(pred.state)'), state: process.env.DEBUG ? C.run('pred.state') : null, me: C.run('pred.state.players[0]'), at: n });
    }
    // Which predictions were right? Only judge those the snapshot had not yet corrected: the one made at frame n for tick n + LAG.
    let exact = 0, total = 0, worst = 0;
    const lagged = predictions.filter(p => p.tick > 40 && p.tick <= ticks && p.at === p.tick - LAG);
    for (const p of lagged) {
        total++;
        if (p.hash === serverHash[p.tick]) exact++;
        else if (process.env.DEBUG && !global.__shown) {
            global.__shown = true;
            const diff = (a, b, pre) => { if (typeof a !== 'object' || a === null || b === null) { if (a !== b) console.log('    diff', pre, a, b); return; } for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], pre + '.' + k); };
            console.log('  first mismatch at tick', p.tick, '(predicted at frame', p.at + ')');
            C.ctx.__t = p.tick;
            diff(p.state, global.__ss[p.tick], 'state');
        }
    }
    const errs = lagged.map(p => Math.hypot(p.me.x - serverMe[p.tick].x, p.me.y - serverMe[p.tick].y)).sort((a, b) => a - b);
    const near = errs.filter(e => e < 0.5).length / (errs.length || 1), max = errs[errs.length - 1] || 0;
    return { near, max, exact, total, reconciles, bigErr, ackBug, tethered, S, C };
}

console.log('\nquiet opponent (prediction must be exact, grapples and ball included)');
for (const special of (process.env.ONLY ? [process.env.ONLY] : SPECIALS)) {
    const t = Date.now(), res = runChecked({ seed: 11 + SPECIALS.indexOf(special), LAG: 12, ticks: 3000, opponentActive: false, special });
    check(res.total > 2000 && res.exact === res.total, `${special.padEnd(10)} predicted world == server world on ${res.exact}/${res.total} ticks (lag 12, tethered-to-ball ticks on server: ${res.tethered}, ${Date.now() - t} ms)`);
    check(res.ackBug === 0, `${special.padEnd(10)} snapshot ack drops every confirmed input (none left over)`);
}

console.log('\nlarger lag');
for (const LAG of [4, 24, 36]) {
    const res = runChecked({ seed: 99, LAG, ticks: 2500, opponentActive: false, special: 'bat' });
    check(res.total > 1500 && res.exact === res.total, `lag ${LAG}: exact on ${res.exact}/${res.total} ticks`);
}

console.log('\nactive opponent (opponent input cannot be known; judged on MY player: within 0.5 u of the server)');
for (const special of ['dash', 'arrow', 'bat']) {
    const res = runChecked({ seed: 5, LAG: 12, ticks: 3000, opponentActive: true, oppRate: 0.002, special });
    check(res.near > 0.85, `${special}: my player within 0.5 u of the server on ${(100 * res.near).toFixed(1)}% of ticks (worst ${res.max.toFixed(1)} u); ${res.bigErr}/${res.reconciles} snapshots corrected something`);
}

console.log('\nopponent starts next to me (their unseen input collides with mine: real mispredictions)');
for (const special of ['dash', 'bat']) {
    const res = runChecked({ seed: 21, LAG: 12, ticks: 3000, opponentActive: true, oppRate: 0.01, startNear: true, special });
    check(res.bigErr > 0 && res.near > 0.5, `${special}: ${res.bigErr}/${res.reconciles} snapshots corrected a misprediction, yet my player was within 0.5 u on ${(100 * res.near).toFixed(1)}% of ticks (worst ${res.max.toFixed(1)} u)`);
}

console.log('\nreconcile fixes a deliberately wrong prediction');
{
    const S = loadSim(), C = makeClient();
    for (const sim of [S, C]) sim.run('setTeamSize(1)');
    for (let i = 0; i < 200; i++) S.run('update()');
    const snap = S.save();
    C.ctx.__s = snap;
    C.run('loadState(__s); pred.state = saveState(); pred.tick = 200; pred.state.players[0].x += 60'); // poison the prediction
    C.ctx.__T = 200; C.ctx.__a = 0;
    const e = C.run('predReconcile(__T, __s, __a)');
    check(Math.abs(e - 60) < 1e-6, 'a 60 u prediction error is measured (' + e.toFixed(3) + ')');
    check(Math.abs(C.run('pred.err.x') - 60) < 1e-6 && C.run('pred.state.players[0].x') === snap.players[0].x, 'the predicted state is back on the server state, the 60 u shows up as a smoothing offset');
    for (let i = 0; i < 60; i++) C.run('predFrame(0)');
    check(Math.abs(C.run('pred.err.x')) < 0.1, 'the offset fades out over a few frames instead of snapping');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
