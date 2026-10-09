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
    sim.ctx.performance = performance;
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

console.log('\nwhat is drawn from which timeline');
{
    const S = loadSim(), C = makeClient();
    for (const sim of [S, C]) sim.run('setTeamSize(1)');
    for (let i = 0; i < 300; i++) S.run('update()');
    const snap = S.save();
    C.ctx.__s = snap;
    C.run('predReconcile(300, __s, 0)');
    // the predicted world: the ball is further along, I have an arrow and a peg out; the interpolated (older) world has the opponent's arrow and peg too
    C.run(`pred.state.ball.x = 600; pred.state.ball.th = 0; pred.state.ball.r = 14;
           pred.state.arrows = [{ owner: 0, x: 1 }]; pred.state.pegs = [{ owner: 0, x: 11 }];`);
    const mixed = JSON.parse(JSON.stringify(snap));
    mixed.ball.x = 500; mixed.arrows = [{ owner: 0, x: 2 }, { owner: 1, x: 3 }]; mixed.pegs = [{ owner: 1, x: 12 }, { owner: 0, x: 13 }];
    mixed.players[1].onBall = true; mixed.players[1].tball = 0; mixed.players[1].hookAng = 0; mixed.players[1].rope = { x: 500, y: 0 };
    C.ctx.__m = mixed;
    const out = C.run('predShape(__m)');
    check(out.ball.x === 600, 'the death ball comes from the predicted timeline (the swing and the hit are on the same clock)');
    check(JSON.stringify(out.arrows.map(a => a.x)) === '[3,1]', 'arrows: the opponent\'s from the drawn world, mine from the prediction (no duplicate of mine)');
    check(JSON.stringify(out.pegs.map(q => q.x)) === '[12,11]', 'plinko pegs: same split');
    check(Math.abs(Math.hypot(out.players[1].rope.x - 600, out.players[1].rope.y - out.ball.y) - 14) < 1e-6, 'an opponent tethered to the ball has their hook moved onto the predicted ball');
    check(mixed.ball.x === 500 && mixed.arrows.length === 2, 'the interpolated state itself is not modified');
    C.run('pred.errBall.x = 30');
    check(C.run('predShape(__m)').ball.x === 630, 'a pending ball correction is added to the drawn ball');
    C.run('pred.errBall.x = 0; pred.state.pause = 1');
    check(C.run('predShape(__m)').ball.x === 500, 'while the predicted world is frozen on a goal the drawn ball stays on the drawn timeline');
    C.run('pred.state.pause = 0; PRED_WORLD_OFF = 1');
}
{
    console.log('\nball corrections are smoothed, not snapped');
    const S = loadSim(), C = makeClient();
    for (const sim of [S, C]) sim.run('setTeamSize(1)');
    for (let i = 0; i < 200; i++) S.run('update()');
    const snap = S.save();
    C.ctx.__s = snap;
    C.run('predReconcile(200, __s, 0); pred.state.ball.x += 70; pred.state.ball.y -= 20'); // my prediction had the ball somewhere else than the server says
    C.run('predReconcile(200, __s, 0)');
    check(Math.abs(C.run('pred.errBall.x') - 70) < 1e-6 && Math.abs(C.run('pred.errBall.y') + 20) < 1e-6, 'a late opponent hit on the ball shows up as a blended correction (70, -20)');
    C.run('pred.state.ball.x += 400');
    C.run('predReconcile(200, __s, 0)');
    check(C.run('pred.errBall.x') < 100, 'a huge ball correction snaps instead of sliding across the arena');
}

console.log('\nmy own hit effects fire at predicted time and their server copies are dropped');
{
    const S = loadSim(), C = makeClient(), LAG = 12, r = rng(77);
    for (const sim of [S, C]) { sim.run('setTeamSize(1)'); sim.run("players[0].special = 'bat'; players[1].special = 'dash'"); }
    S.run('players[0].x = players[0].sx = NETX - 60'); // standing beside the ball, so swings connect
    C.run('var __pf = []; events.onBatHit = (p, b, x, y, ux, uy, k) => __pf.push(pred.tick); events.onImpact = () => {};');
    S.run('var __sv = []; var __tk = 0; events.onBatHit = (p, b) => __sv.push(__tk); events.onImpact = () => {};');
    const inflightIn = [], inflightSnap = [];
    let bits = 0, seq = 0, applied = 0, serverSeq = 0;
    for (let n = 1; n <= 3000; n++) {
        let nb = bits;
        if (r() < 0.03) nb ^= NET_BITS.sp; // only swing: stand still beside the ball
        if (nb !== bits) {
            bits = nb; ++seq;
            C.ctx.__b = bits; C.ctx.__q = seq; C.ctx.__base = n - 1 + LAG;
            C.run('predPress(__b, __q, pred.state ? pred.tick : __base)');
            inflightIn.push({ at: n + LAG, seq, bits });
        }
        while (inflightIn.length && inflightIn[0].at <= n) { const m = inflightIn.shift(); applied = m.bits; serverSeq = m.seq; }
        S.ctx.__tk = n;
        S.run(`Object.assign(players[0].keys, ${bitsToKeys(applied)}); update()`);
        if (n % 4 === 0) inflightSnap.push({ at: n + LAG, tick: n, ack: serverSeq, s: JSON.parse(JSON.stringify(S.save())) });
        while (inflightSnap.length && inflightSnap[0].at <= n) {
            const m = inflightSnap.shift();
            C.ctx.__T = m.tick; C.ctx.__s = m.s; C.ctx.__a = m.ack;
            C.run('predReconcile(__T, __s, __a)');
        }
        C.ctx.__t = n + LAG;
        C.run('predAdvance(__t)');
    }
    const serverHits = S.run('__sv'), predicted = C.run('__pf');
    check(serverHits.length >= 3, `the scenario produces bat hits (${serverHits.length})`);
    // each predicted hit is at tick t of the server timeline; the server reaches the same tick LAG ticks of real time later... compare in server ticks
    check(predicted.length === serverHits.length, `exactly one predicted effect per real hit, none doubled by rollbacks (${predicted.length} predicted, ${serverHits.length} real)`);
    check(predicted.every((t, i) => t === serverHits[i] || Math.abs(t - serverHits[i]) <= 1), 'and each is for the same sim tick as the real one');
    // the dedupe: a server event for my slot that matches a predicted one is dropped once; one with no prediction goes through
    C.ctx.__e1 = ['bt', serverHits[0], 0, 'b', 0, 0, 0, 0, 0];
    C.run('pred.fired = [{ type: "bt", tick: __e1[1], used: false }]');
    check(C.run('predSkipServerEvent(__e1)') === true && C.run('predSkipServerEvent(__e1)') === false, 'the server copy of a predicted hit is dropped once, a second one is not');
    C.ctx.__e2 = ['bt', 5000, 1, 'b', 0, 0, 0, 0, 0];
    check(C.run('predSkipServerEvent(__e2)') === false, 'effects belonging to the opponent are never dropped');
}

console.log('\nwhat is DRAWN for my rope and decoy (the drawn world is older than the predicted one)');
function drawnInvariants({ LAG, DELAY, seed, special, script, ticks, opp }) {
    const S = loadSim(), C = makeClient(), r = rng(seed), hist = [];
    for (const sim of [S, C]) { sim.run('setTeamSize(1)'); sim.run(`players[0].special = '${special}'; players[1].special = 'decoy'`); }
    const inflightIn = [], inflightSnap = [];
    let bits = 0, seq = 0, applied = 0, serverSeq = 0, bits1 = 0;
    const res = { frames: 0, tetheredDecoy: 0, decoyDrawnEarly: 0, ropeOff: 0, ropeOffOpp: 0, worst: 0, worstOpp: 0, rawOpp: 0, myDecoyMissing: 0, sawMyDecoy: 0, wrongTarget: 0 };
    for (let n = 1; n <= ticks; n++) {
        let nb = bits;
        const f = script(n, r);
        nb = (nb & ~(f.mask || 0)) | (f.set || 0);
        if (nb !== bits) {
            bits = nb; ++seq;
            C.ctx.__b = bits; C.ctx.__q = seq; C.ctx.__base = n - 1 + LAG;
            C.run('predPress(__b, __q, pred.state ? pred.tick : __base)');
            inflightIn.push({ at: n + LAG, seq, bits });
        }
        while (inflightIn.length && inflightIn[0].at <= n) { const m = inflightIn.shift(); applied = m.bits; serverSeq = m.seq; }
        if (opp) bits1 = opp(n, r, bits1);
        S.run(`Object.assign(players[0].keys, ${bitsToKeys(applied)}); Object.assign(players[1].keys, ${bitsToKeys(bits1)}); update()`);
        hist[n] = JSON.parse(JSON.stringify(S.save()));
        if (n % 4 === 0) inflightSnap.push({ at: n + LAG, tick: n, ack: serverSeq, s: hist[n] });
        while (inflightSnap.length && inflightSnap[0].at <= n) {
            const m = inflightSnap.shift();
            C.ctx.__T = m.tick; C.ctx.__s = m.s; C.ctx.__a = m.ack;
            C.run('predReconcile(__T, __s, __a)');
        }
        C.ctx.__t = n + LAG;
        C.run('predAdvance(__t)');
        const drawnTick = n - LAG - DELAY;
        if (drawnTick < 60 || !C.run('!!pred.state')) continue;
        C.ctx.__m = hist[drawnTick];
        const out = C.run('predShape(__m)');
        res.frames++;
        const me = out.players[0];
        if (C.run('pred.state.players[0].tball') > 0) {
            res.tetheredDecoy++;
            const d = out.decoys[me.tball - 1];
            if (!d) { res.wrongTarget++; continue; }
            const off = Math.abs(Math.hypot(me.rope.x - d.x, me.rope.y - d.y) - d.r);
            res.worst = Math.max(res.worst, off);
            if (off > 1) res.ropeOff++;
        }
        const mineDrawn = out.decoys.find(d => d.owner === 0), mineReal = hist[n].decoys.find(d => d.owner === 0), mineOld = hist[drawnTick].decoys.find(d => d.owner === 0);
        if (mineReal) res.sawMyDecoy++;
        if (mineReal && !mineOld && mineDrawn) res.decoyDrawnEarly++;
        if (mineReal && !mineDrawn && C.run('pred.state.decoys.some(d => d.owner === 0)')) res.myDecoyMissing++;
        // the opponent's rope, when it is on a decoy: hook on that decoy's edge in the DRAWN list, whichever decoy (mine from the prediction) it is
        const opp1 = out.players[1];
        if (opp1.onBall && opp1.tball > 0) {
            const d = out.decoys[opp1.tball - 1];
            if (d) { const off = Math.abs(Math.hypot(opp1.rope.x - d.x, opp1.rope.y - d.y) - d.r); res.worstOpp = Math.max(res.worstOpp, off); if (off > res.rawOpp + 0.5) res.ropeOffOpp++; }
        }
        const rawO = hist[drawnTick].players[1]; // the unmodified server state: the sim itself places the hook before the decoy moves, so it is never exactly on the edge
        if (rawO.onBall && rawO.tball > 0) { const d = hist[drawnTick].decoys[rawO.tball - 1]; if (d) res.rawOpp = Math.max(res.rawOpp, Math.abs(Math.hypot(rawO.rope.x - d.x, rawO.rope.y - d.y) - d.r)); }
    }
    return res;
}
const castThenGrapple = (n, r) => { // cast the decoy, then hold the grapple and swing about
    const f = { set: 0, mask: 0 };
    if (n === 10) f.set |= NET_BITS.sp;
    if (n === 13) f.mask |= NET_BITS.sp;
    if (n === 150) f.set |= NET_BITS.z;
    if (n > 150 && n % 40 === 0) f.set |= NET_BITS[r() < 0.5 ? 'l' : 'r'];
    if (n > 150 && n % 40 === 20) f.mask |= NET_BITS.l | NET_BITS.r;
    if (n === 900) f.mask |= NET_BITS.z;
    return f;
};
for (const [LAG, DELAY] of [[12, 12], [24, 20]]) {
    const res = drawnInvariants({ LAG, DELAY, seed: 3, special: 'decoy', script: castThenGrapple, ticks: 900 });
    check(res.tetheredDecoy > 100 && res.sawMyDecoy > 100, `scenario really grapples my own decoy (${res.tetheredDecoy} frames tethered, decoy alive for ${res.sawMyDecoy} frames)`);
    check(res.wrongTarget === 0 && res.ropeOff === 0, `lag ${LAG}: my hook sits on the decoy I see, every frame (worst ${res.worst.toFixed(2)} u off its edge, ${res.wrongTarget} frames with no decoy at my tether)`);
    check(res.decoyDrawnEarly > 20, `lag ${LAG}: my decoy appears the moment it is cast, not a lag later (${res.decoyDrawnEarly} frames drawn ahead of the drawn world)`);
}
{
    // the opponent is swinging on THEIR decoy and I am grappling mine: both hooks stay on what is drawn
    const oppScript = (n, r, b) => { if (n === 12) return b | NET_BITS.sp; if (n === 15) return b & ~NET_BITS.sp; if (n === 160) return b | NET_BITS.z; if (n > 160 && n % 50 === 0) return (b & ~(NET_BITS.l | NET_BITS.r)) | NET_BITS[r() < 0.5 ? 'l' : 'r']; return b; };
    const res = drawnInvariants({ LAG: 12, DELAY: 12, seed: 8, special: 'decoy', script: castThenGrapple, ticks: 900, opp: oppScript });
    check(res.ropeOff === 0 && res.ropeOffOpp === 0, `both players on decoys: my rope ${res.ropeOff} bad frames, theirs ${res.ropeOffOpp} bad frames (worst ${res.worst.toFixed(2)} / ${res.worstOpp.toFixed(2)} u; the raw server state itself is ${res.rawOpp.toFixed(2)} u off, that is the sim's one-tick order)`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
