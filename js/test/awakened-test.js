// Headless tests for the Awakened special: press to power up for 10 s, then a 15 s cooldown. While awake: the grapple meter does not drain, you cannot be overcharged,
// the Death Ball cannot kill you, and your crashes hit 3x as hard on balls, decoys and players. Run:  node test/awakened-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.abs(b);
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const tap = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
function fresh(special, awake) { // awake: press the key like a player would (the opening cooldown is skipped)
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run(`players[0].special = '${special}'; players[0].reset(); pause = 0; players[0].cd.awakened = 0`);
    if (awake) tap(sim);
    return sim;
}
const AWAKE = P(fresh('awakened', true), 'awakeT') > 0;

// timeline: ready -> press -> 10 s awake -> 15 s cooldown -> ready again
{
    const sim = fresh('awakened', false);
    check(P(sim, 'awakeT') === 0, 'before the press: not awake');
    tap(sim);
    check(P(sim, 'awakeT') > 9.9, `press: awake (${P(sim, 'awakeT').toFixed(2)} s left)`);
    tap(sim);
    check(P(sim, 'awakeT') < 10 - 0.015 && P(sim, 'awakeT') > 9.9, 'pressing again while awake does nothing (no restart)');
    ticks(sim, 9.5);
    check(P(sim, 'awakeT') > 0 && P(sim, 'cd.awakened') === 0, `still awake at ~9.5 s (${P(sim, 'awakeT').toFixed(2)} s left, no cooldown yet)`);
    ticks(sim, 0.6);
    check(P(sim, 'awakeT') === 0 && P(sim, 'crashK') === 1, 'wears off after 10 s');
    check(near(P(sim, 'cd.awakened'), 15, 0.02), `cooldown starts when it wears off: ${P(sim, 'cd.awakened').toFixed(2)} s`);
    tap(sim);
    check(P(sim, 'awakeT') === 0, 'pressing during the cooldown does nothing');
    ticks(sim, 15);
    check(P(sim, 'cd.awakened') === 0, 'cooldown is over after 15 s');
    tap(sim);
    check(P(sim, 'awakeT') > 9.9, 'can awaken again');
}
{
    const sim = loadSim(); sim.run('resetMatch()'); sim.run("players[0].special = 'awakened'; players[0].reset(); pause = 0");
    check(near(P(sim, 'cd.awakened'), 15), `a new round starts with the full cooldown (${P(sim, 'cd.awakened')} s)`);
}
{
    const sim = fresh('awakened', true);
    sim.run("players[0].special = 'dash'"); sim.tick();
    check(P(sim, 'awakeT') === 0 && P(sim, 'cd.awakened') === 0 && P(sim, 'crashK') === 1, 'swapping to another special ends it with no cooldown');
    const sim2 = fresh('awakened', true);
    sim2.run('players[0].reset()');
    check(P(sim2, 'awakeT') === 0, 'a new round ends it');
    const sim3 = fresh('awakened', true);
    ticks(sim3, 3);
    const snap = JSON.parse(JSON.stringify(sim3.save())), t = P(sim3, 'awakeT');
    sim3.run('players[0].awakeT = 0'); sim3.load(snap);
    check(Math.abs(P(sim3, 'awakeT') - t) < 1e-9 && P(sim3, 'crashK') === 3, `save/load keeps the power-up (${P(sim3, 'awakeT').toFixed(2)} s left)`);
}

// no grapple usage: hold a rope far longer than the 4 s meter allows
for (const [sp, awake] of [['dash', false], ['awakened', true]]) {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 500; players[0].keys.z = true');
    let over = -1;
    for (let t = 1; t <= 8 * 120 && over < 0; t++) { sim.tick(); if (P(sim, 'gCool') > 0) over = t; }
    if (awake) check(over < 0 && P(sim, 'rope') !== null && near(P(sim, 'gCharge'), 4, 0.01), `awake: rope held 8 s, meter still ${P(sim, 'gCharge').toFixed(2)} s, never overcharged`);
    else check(over > 0 && near(over / 120, 4, 0.06), `plain: overcharges after ${(over / 120).toFixed(2)} s (control)`);
}

// cannot be overcharged by touching an enemy with the rope out, and an existing lockout is lifted
const touch = (sp, awake) => {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 500; players[0].keys.z = true');
    ticks(sim, 0.4);
    const had = P(sim, 'rope') !== null || P(sim, 'pending') !== null;
    sim.run('players[1].netSide = 0; players[1].x = players[0].x + 20; players[1].y = players[0].y; players[1].vx = players[1].vy = 0'); // (netSide: the net guard must not shove it back to its own side)
    sim.tick();
    return { had, over: P(sim, 'gCool') > 0 };
};
{
    const c = touch('dash', false), a = touch('awakened', true);
    check(c.had && c.over, 'plain: touching an enemy with the grapple out overcharges (control)');
    check(a.had && !a.over, 'awake: touching an enemy with the grapple out does nothing');
    const sim = fresh('awakened', false);
    sim.run('players[0].overcharge()');
    check(P(sim, 'gCool') > 0, 'scenario: locked out before awakening');
    tap(sim);
    check(P(sim, 'gCool') === 0, 'awakening lifts a running lockout');
    sim.run('players[0].overcharge()');
    check(P(sim, 'gCool') === 0, 'overcharge() does nothing while awake');
}

// unkillable against the Death Ball
const ballTouch = (sp, awake) => {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 300; players[0].vx = 250; players[0].vy = 0; ball.x = 300 + 16 + 14 - 2; ball.y = 300; ball.vx = ball.vy = 0; ball.w = 0');
    sim.tick();
    return { alive: P(sim, 'alive'), bvx: sim.run('ball.vx'), sim };
};
{
    const c = ballTouch('dash', false), a = ballTouch('awakened', true);
    check(!c.alive, 'plain: the Death Ball kills (control)');
    check(a.alive, 'awake: the Death Ball does not kill you');
    check(a.bvx > c.bvx * 2.9 && a.bvx < c.bvx * 3.1, `crash on the Death Ball: ${c.bvx.toFixed(0)} u/s plain, ${a.bvx.toFixed(0)} u/s awake (x${(a.bvx / c.bvx).toFixed(2)})`);
    ticks(a.sim, 1);
    check(P(a.sim, 'alive'), 'still alive a second later (it bounced off, no repeat kill)');
    const sim = fresh('awakened', true);
    ticks(sim, 10.5);
    sim.run('players[0].x = 300; players[0].y = 300; players[0].vx = 250; players[0].vy = 0; ball.x = 300 + 16 + 14 - 2; ball.y = 300; ball.vx = ball.vy = 0');
    sim.tick();
    check(!P(sim, 'alive'), 'once it has worn off, the Death Ball kills again');
}

// 3x crash on a decoy and on another player
{
    const decoyHit = (sp, awake) => {
        const sim = fresh(sp, awake);
        sim.run('players[0].x = 300; players[0].y = 300; players[0].vx = 250; players[0].vy = 0; spawnDecoy(players[1], 300 + 16 + 14 - 2, 300); decoys[0].vx = 0; decoys[0].vy = 0');
        sim.tick();
        return sim.run('decoys[0].vx');
    };
    const d0 = decoyHit('dash', false), d1 = decoyHit('awakened', true);
    check(d0 > 50 && near(d1 / d0, 3, 0.04), `crash on a decoy: ${d0.toFixed(0)} u/s plain, ${d1.toFixed(0)} u/s awake (x${(d1 / d0).toFixed(2)})`);
    const playerHit = (sp, awake) => {
        const sim = fresh(sp, awake);
        sim.run('players[0].x = 300; players[0].y = 300; players[0].vx = 250; players[0].vy = 0; players[1].netSide = 0; players[1].x = 300 + 32 - 2; players[1].y = 300; players[1].vx = players[1].vy = 0');
        sim.tick();
        return P(sim, 'vx', 1);
    };
    const p0 = playerHit('dash', false), p1 = playerHit('awakened', true);
    check(p0 > 50 && near(p1 / p0, 3, 0.04), `crash on a player: ${p0.toFixed(0)} u/s plain, ${p1.toFixed(0)} u/s awake (x${(p1 / p0).toFixed(2)})`);
    const noBoost = ballTouch('awakened', false);
    check(noBoost.alive === false, 'Awakened equipped but not active: no protection, no bonus');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
