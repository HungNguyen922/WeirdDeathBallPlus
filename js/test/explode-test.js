// Headless tests for the Explode special. Run:  node js/test/explode-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const near = (a, b, tol = 0.03) => Math.abs(a - b) <= tol * Math.abs(b);
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const tap = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
const K = loadSim(), C = n => K.run(n);
const R = C('EXPLODE_R'), CD = C('EXPLODE_COOLDOWN'), PR = 16, BR = C('BALL_R'); // blast radius, cooldown, player radius, ball / decoy radius
const kick = (d, r) => C('EXPLODE_KICK_MIN') + (C('EXPLODE_KICK_MAX') - C('EXPLODE_KICK_MIN')) * Math.pow(1 - Math.min(1, d / (R + r)), C('EXPLODE_FALLOFF')); // the kick at distance d from a body of radius r
function fresh(size = 1) {
    const sim = loadSim();
    if (size === 2) sim.run('setTeamSize(2)'); else sim.run('resetMatch()');
    sim.run("players[0].special = 'explode'; players[0].reset(); pause = 0; players[0].cd.explode = 0");
    sim.run('players[0].netSide = 1; players[0].x = 600; players[0].y = 500; players[0].vx = players[0].vy = 0');
    return sim;
}
const put = (sim, i, x, y) => sim.run(`players[${i}].netSide = 1; players[${i}].x = ${x}; players[${i}].y = ${y}; players[${i}].vx = players[${i}].vy = 0`);
const killWithBall = (sim, i) => { put(sim, i, 640, 500); sim.run('ball.x = 660; ball.y = 500; ball.vx = ball.vy = 0; ball.w = 0'); sim.tick(); };

console.log(`  info radius ${R} u (+ the body's own radius), kick ${C('EXPLODE_KICK_MIN')}..${C('EXPLODE_KICK_MAX')} u/s, cooldown ${CD} s`);
{ // players: direction, strength, radius
    const sim = fresh();
    put(sim, 1, 640, 500); tap(sim);
    check(near(P(sim, 'vx', 1), kick(40, PR), 0.06) && Math.abs(P(sim, 'vy', 1)) < 40, `an enemy 40 u away is blasted straight away, about ${kick(40, PR).toFixed(0)} u/s (vx ${P(sim, 'vx', 1).toFixed(0)}, vy ${P(sim, 'vy', 1).toFixed(0)})`);
    check(Math.abs(P(sim, 'vx')) < 5, 'the caster is not pushed');
    const d = fresh(); put(d, 1, 630, 470); tap(d);
    check(P(d, 'vx', 1) > 300 && P(d, 'vy', 1) < -300 && near(P(d, 'vx', 1), -P(d, 'vy', 1), 0.15), `a diagonal enemy is blasted along the line from you (vx ${P(d, 'vx', 1).toFixed(0)}, vy ${P(d, 'vy', 1).toFixed(0)})`);
    const out = fresh(); put(out, 1, 600 + R + PR + 6, 500); tap(out);
    check(Math.abs(P(out, 'vx', 1)) < 5, `an enemy whose edge is 6 u outside the radius is not touched`);
    const inn = fresh(); put(inn, 1, 600 + R + PR - 4, 500); tap(inn);
    check(P(inn, 'vx', 1) > 300, `an enemy 4 u inside the radius is (${P(inn, 'vx', 1).toFixed(0)} u/s)`);
    const cd = fresh(); put(cd, 1, 640, 500); tap(cd);
    check(near(P(cd, 'cd.explode'), CD, 0.02), `cooldown starts: ${P(cd, 'cd.explode').toFixed(2)} s`);
    put(cd, 1, 640, 500); tap(cd);
    check(Math.abs(P(cd, 'vx', 1)) < 5, 'pressing during the cooldown does nothing');
}
{ // the death ball and decoys
    const sim = fresh();
    sim.run('ball.x = 640; ball.y = 500; ball.vx = ball.vy = 0; ball.w = 0'); tap(sim);
    check(near(sim.run('ball.vx'), kick(40, BR), 0.08) && Math.abs(sim.run('ball.vy')) < 60, `the death ball 40 u away is blasted straight away (vx ${sim.run('ball.vx').toFixed(0)}, expected ~${kick(40, BR).toFixed(0)})`);
    const far = fresh(); far.run(`ball.x = ${600 + R + BR + 8}; ball.y = 500; ball.vx = ball.vy = 0`); tap(far);
    check(Math.abs(far.run('ball.vx')) < 5, 'a ball just outside the radius is not touched');
    const d = fresh(); d.run('spawnDecoy(players[1], 570, 470); decoys[0].vx = decoys[0].vy = 0'); tap(d);
    check(d.run('decoys[0].vx') < -300 && d.run('decoys[0].vy') < -300, `a decoy is blasted along the line from you (vx ${d.run('decoys[0].vx').toFixed(0)}, vy ${d.run('decoys[0].vy').toFixed(0)})`);
    const df = fresh(); df.run(`spawnDecoy(players[1], ${600 + R + BR + 8}, 500); decoys[0].vx = decoys[0].vy = 0`); tap(df);
    check(Math.abs(df.run('decoys[0].vx')) < 5, 'a decoy just outside the radius is not touched');
    const both = fresh();
    both.run('ball.x = 640; ball.y = 500; ball.vx = ball.vy = 0; spawnDecoy(players[1], 560, 500); decoys[0].vx = decoys[0].vy = 0');
    put(both, 1, 600, 440); tap(both);
    check(both.run('ball.vx') > 300 && both.run('decoys[0].vx') < -300 && both.run('players[1].vy') < -300, 'players, ball and decoy are all blasted by the same press');
    const fast = fresh(); fast.run('ball.x = 640; ball.y = 500; ball.vx = 800; ball.vy = 0'); tap(fast);
    check(fast.run('ball.vx') > 1000, `a ball already flying away at 800 u/s is amplified and not clipped at its normal cap (${fast.run('ball.vx').toFixed(0)} u/s)`);
}
{ // 2v2: teammates are blasted too; deaths do not end the round
    const sim = fresh(2);
    put(sim, 2, 560, 500); put(sim, 1, 640, 500); put(sim, 3, 900, 500); tap(sim);
    check(P(sim, 'vx', 2) < -300, `a teammate is blasted too (vx ${P(sim, 'vx', 2).toFixed(0)})`);
    check(Math.abs(P(sim, 'vx', 3)) < 5, 'a far-away player is not touched');
}
for (const [secs, refund, label] of [[1, true, 'a death 1 s after the blast'], [4.8, true, 'a death at 4.8 s'], [5.3, false, 'a death after the window']]) {
    const sim = fresh(2);
    put(sim, 1, 640, 500); put(sim, 3, 900, 500); tap(sim); ticks(sim, secs); killWithBall(sim, 1);
    if (refund) check(!P(sim, 'alive', 1) && P(sim, 'cd.explode') === 0 && P(sim, 'exploCarry') === true, `${label} resets the cooldown to zero and marks it to carry`);
    else check(!P(sim, 'alive', 1) && P(sim, 'cd.explode') > 0 && !P(sim, 'exploCarry'), `${label} does not (cooldown still ${P(sim, 'cd.explode').toFixed(1)} s)`);
    if (secs === 1) { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); check(near(P(sim, 'cd.explode'), CD, 0.02), 'so Explode can be used again at once'); }
}
{
    const sim = fresh(2);
    killWithBall(sim, 1); sim.run('ball.reset()'); put(sim, 3, 640, 500); tap(sim); ticks(sim, 1);
    check(P(sim, 'cd.explode') > CD - 2, 'a death from before the blast does not count');
}
{ // 1v1: the death ends the round, so the refund is carried over
    const sim = fresh();
    put(sim, 1, 640, 500); tap(sim); killWithBall(sim, 1);
    check(sim.run('pause') > 0 && P(sim, 'cd.explode') === 0, 'the kill ended the round and the cooldown is zero');
    ticks(sim, 2.2);
    check(P(sim, 'alive', 1) && P(sim, 'cd.explode') === 0 && P(sim, 'exploCarry') === false, 'next round: Explode starts ready, and the carry is used up');
    sim.run('players[0].reset()');
    check(near(P(sim, 'cd.explode'), CD, 0.02), 'the round after that starts with the normal full cooldown');
    const c = fresh(); put(c, 1, 640, 500); killWithBall(c, 1); ticks(c, 2.2);
    check(P(c, 'cd.explode') > CD - 1.5, `control: a kill with no blast gives no head start (cooldown ${P(c, 'cd.explode').toFixed(1)} s next round)`);
    const m = fresh(); m.run('players[0].exploCarry = true; resetMatch()');
    check(near(P(m, 'cd.explode'), CD, 0.02), 'a new match never inherits a carried refund');
}
{ // the refund survives a point but not the end of a match
    const sim = fresh();
    put(sim, 1, 640, 500); tap(sim); sim.run('score = [WIN - 1, 0]'); killWithBall(sim, 1);
    check(sim.run('over') === true && P(sim, 'exploCarry') === true, 'the kill wins the match with a refund waiting');
    ticks(sim, 4.2);
    check(sim.run('score')[0] === 0 && P(sim, 'exploCarry') === false && near(P(sim, 'cd.explode'), CD, 0.04), `the next match starts with the full cooldown (${P(sim, 'cd.explode').toFixed(1)} s)`);
}
{
    const sim = fresh(2);
    put(sim, 1, 640, 500); tap(sim); ticks(sim, 1);
    const snap = JSON.parse(JSON.stringify(sim.save())), t = P(sim, 'exploT'), d = P(sim, 'exploDead');
    sim.run('players[0].exploT = 0; players[0].exploDead = 99'); sim.load(snap);
    check(Math.abs(P(sim, 'exploT') - t) < 1e-9 && P(sim, 'exploDead') === d, 'save/load keeps the refund window');
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);