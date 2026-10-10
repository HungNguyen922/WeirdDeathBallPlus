// Headless tests for the Awakened special: press to power up for 10 s (150% grapple use, range, crash shots and weighted kicks; 50% shorter overcharge lockout), then a 20 s cooldown. Run:  node test/awakened-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.abs(b);
const P = (sim, e) => sim.run('players[0].' + e);
const tap = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
function fresh(special, awake) { // awake: press the key like a player would (the opening cooldown is skipped)
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run(`players[0].special = '${special}'; players[0].reset(); pause = 0; players[0].cd.awakened = 0`);
    if (awake) tap(sim);
    return sim;
}
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };

// timeline: ready -> press -> 10 s awake -> 20 s cooldown -> ready again
{
    const sim = fresh('awakened', false);
    check(P(sim, 'awakeT') === 0 && near(P(sim, 'grapMax'), 4), 'before the press: not awake, normal meter');
    tap(sim);
    check(P(sim, 'awakeT') > 9.9 && near(P(sim, 'grapMax'), 6) && near(P(sim, 'range'), 192), `press: awake (${P(sim, 'awakeT').toFixed(2)} s left, meter ${P(sim, 'grapMax')}, range ${P(sim, 'range')})`);
    tap(sim);
    check(P(sim, 'awakeT') < 10 - 0.015 && P(sim, 'awakeT') > 9.9, 'pressing again while awake does nothing (no restart)');
    ticks(sim, 9.5);
    check(P(sim, 'awakeT') > 0 && P(sim, 'cd.awakened') === 0, `still awake at ~9.5 s (${P(sim, 'awakeT').toFixed(2)} s left, no cooldown yet)`);
    ticks(sim, 0.6);
    check(P(sim, 'awakeT') === 0 && near(P(sim, 'grapMax'), 4), 'wears off after 10 s: normal numbers again');
    check(near(P(sim, 'cd.awakened'), 20, 0.02), `cooldown starts when it wears off: ${P(sim, 'cd.awakened').toFixed(2)} s`);
    tap(sim);
    check(P(sim, 'awakeT') === 0, 'pressing during the cooldown does nothing');
    ticks(sim, 20);
    check(P(sim, 'cd.awakened') === 0, 'cooldown is over after 20 s');
    tap(sim);
    check(P(sim, 'awakeT') > 9.9, 'can awaken again');
}

// the meter keeps its share across the switch
{
    const sim = fresh('awakened', false);
    sim.run('players[0].gCharge = 2');
    tap(sim);
    check(near(P(sim, 'gCharge'), 3, 0.03), `half a meter stays half (2/4 -> ${P(sim, 'gCharge').toFixed(2)}/6)`);
    ticks(sim, 10.2);
    check(near(P(sim, 'gCharge'), 2, 0.12) || P(sim, 'gCharge') <= 4, `and back down when it wears off (${P(sim, 'gCharge').toFixed(2)}/4)`);
}

// not awake until pressed; opening cooldown like every other special
{
    const sim = loadSim(); sim.run('resetMatch()'); sim.run("players[0].special = 'awakened'; players[0].reset(); pause = 0");
    check(near(P(sim, 'cd.awakened'), 20), `a new round starts with the full cooldown (${P(sim, 'cd.awakened')} s)`);
}

// swapping away / new round end it, without a cooldown
{
    const sim = fresh('awakened', true);
    sim.run("players[0].special = 'dash'"); sim.tick();
    check(P(sim, 'awakeT') === 0 && P(sim, 'cd.awakened') === 0 && near(P(sim, 'grapMax'), 4), 'swapping to another special ends it with no cooldown');
    const sim2 = fresh('awakened', true);
    sim2.run('players[0].reset()');
    check(P(sim2, 'awakeT') === 0 && near(P(sim2, 'gCharge'), 4), 'a new round ends it');
}

// save -> JSON -> load keeps it
{
    const sim = fresh('awakened', true);
    ticks(sim, 3);
    const snap = JSON.parse(JSON.stringify(sim.save())), t = P(sim, 'awakeT');
    sim.run('players[0].awakeT = 0'); sim.load(snap);
    check(Math.abs(P(sim, 'awakeT') - t) < 1e-9 && near(P(sim, 'grapMax'), 6), `save/load keeps the power-up (${P(sim, 'awakeT').toFixed(2)} s left)`);
}

// the boosts themselves, awake vs a plain player
for (const [sp, awake, m, lock] of [['dash', false, 1, 6], ['awakened', true, 1.5, 3]]) {
    const sim = fresh(sp, awake);
    check(near(P(sim, 'grapMax'), 4 * m) && near(P(sim, 'range'), 128 * m) && near(P(sim, 'kickV'), m) && near(P(sim, 'crashK'), m) && near(P(sim, 'grapLock'), lock), `${sp}${awake ? ' (awake)' : ''}: meter ${P(sim, 'grapMax')}, range ${P(sim, 'range')}, kick x${P(sim, 'kickV')}, crash x${P(sim, 'crashK')}, lockout ${P(sim, 'grapLock')} s`);
}
for (const [sp, awake, want] of [['dash', false, false], ['awakened', true, true]]) {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 200; ball.x = 460; ball.y = 200; ball.vx = ball.vy = 0');
    check(sim.run('players[0].candidates(ball).some(c => c.b)') === want, `${sp}: a ball ~146 u from the hook point ${want ? 'is' : 'is not'} in reach`);
}
for (const [sp, awake, use, lock] of [['dash', false, 4, 6], ['awakened', true, 6, 3]]) {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 500; players[0].keys.z = true');
    let t = 0, over = -1;
    while (t < 12 * 120 && over < 0) { sim.tick(); t++; if (P(sim, 'gCool') > 0) over = t; }
    check(over > 0 && near(over / 120, use, 0.06), `${sp}: grapple overcharges after ${(over / 120).toFixed(2)} s (expected ~${use})`);
    let cool = 0; sim.run('players[0].keys.z = false');
    while (P(sim, 'gCool') > 0 && cool < 12 * 120) { sim.tick(); cool++; }
    check(near(cool / 120, lock, 0.06), `${sp}: lockout lasts ${(cool / 120).toFixed(2)} s (expected ${lock})`);
}
const crash = (sp, awake) => {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 300; players[0].vx = 250; players[0].vy = 0; ball.x = 300 + 16 + 14 - 2; ball.y = 300; ball.vx = ball.vy = 0; ball.w = 0');
    sim.run('crashShot(players[0], ball)');
    return sim.run('ball.vx');
};
const c0 = crash('dash', false), c1 = crash('awakened', true), c2 = crash('awakened', false);
check(c0 > 100 && near(c1 / c0, 1.5, 0.01) && near(c2 / c0, 1, 0.01), `crash shot: ${c0.toFixed(0)} u/s normally, ${c1.toFixed(0)} awake (x${(c1 / c0).toFixed(2)}), ${c2.toFixed(0)} with Awakened equipped but not active`);
const kick = (sp, awake) => {
    const sim = fresh(sp, awake);
    sim.run('players[0].x = 300; players[0].y = 450; players[0].vx = 0; players[0].vy = 0; players[0].ground = false');
    sim.run('players[0].rope = { x: 300, y: 560 }; players[0].ropeGround = true; players[0].len = 110; players[0].onBall = false; players[0].tball = null; players[0].kickReq = true; players[0].keys.z = true; players[0].keys.x = true; players[0].gCharge = 3');
    const vy0 = P(sim, 'vy');
    sim.tick();
    return -(P(sim, 'vy') - vy0);
};
const k0 = kick('dash', false), k1 = kick('awakened', true);
check(k0 > 200 && near(k1 / k0, 1.5, 0.06), `weighted kick: ${k0.toFixed(0)} u/s normally, ${k1.toFixed(0)} u/s awake (x${(k1 / k0).toFixed(2)})`);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
