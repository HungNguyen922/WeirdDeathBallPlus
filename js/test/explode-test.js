// Headless tests for the Explode special: press to blast every other living player, the death ball and the decoys within 2 player lengths away from you; a death within 5 s of the blast
// resets the cooldown to zero (and carries into the next round when that death ended the round). Run:  node test/explode-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const near = (a, b, tol = 0.03) => Math.abs(a - b) <= tol * Math.abs(b);
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const tap = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
const R = 2 * 32, KICK = 600; // the blast radius and strength (EXPLODE_R, EXPLODE_KICK)
function fresh(size = 1) {
    const sim = loadSim();
    if (size === 2) sim.run('setTeamSize(2)'); else sim.run('resetMatch()');
    sim.run("players[0].special = 'explode'; players[0].reset(); pause = 0; players[0].cd.explode = 0");
    // everyone on the right-hand side of the net, clear of the ball in its notch; the net guard needs to know that too
    sim.run('players[0].netSide = 1; players[0].x = 600; players[0].y = 500; players[0].vx = players[0].vy = 0');
    return sim;
}
const put = (sim, i, x, y) => sim.run(`players[${i}].netSide = 1; players[${i}].x = ${x}; players[${i}].y = ${y}; players[${i}].vx = players[${i}].vy = 0`);
const killWithBall = (sim, i) => { // the Death Ball lands on player i (and not on the caster)
    put(sim, i, 640, 500);
    sim.run('ball.x = 660; ball.y = 500; ball.vx = ball.vy = 0; ball.w = 0');
    sim.tick();
};

// the radius, the direction, the strength
{
    const sim = fresh();
    check(sim.run('EXPLODE_R') === R && sim.run('EXPLODE_KICK') === KICK, `constants: radius ${sim.run('EXPLODE_R')} u (2 player lengths), kick ${sim.run('EXPLODE_KICK')} u/s`);
    put(sim, 1, 640, 500); // 40 u to the right: inside
    tap(sim);
    check(near(P(sim, 'vx', 1), KICK, 0.08) && Math.abs(P(sim, 'vy', 1)) < 40, `an enemy 40 u away is blasted straight away from you (vx ${P(sim, 'vx', 1).toFixed(0)}, vy ${P(sim, 'vy', 1).toFixed(0)})`);
    check(Math.abs(P(sim, 'vx')) < 5, 'the caster is not pushed');
}
{
    const sim = fresh();
    put(sim, 1, 600 + 30, 500 - 30); // up and to the right, 42 u away
    tap(sim);
    check(P(sim, 'vx', 1) > 300 && P(sim, 'vy', 1) < -300 && near(P(sim, 'vx', 1), -P(sim, 'vy', 1), 0.15), `a diagonal enemy is blasted along the line from you (vx ${P(sim, 'vx', 1).toFixed(0)}, vy ${P(sim, 'vy', 1).toFixed(0)})`);
}
{
    const sim = fresh();
    put(sim, 1, 600 + R + 6, 500); // just outside
    tap(sim);
    check(Math.abs(P(sim, 'vx', 1)) < 5, `an enemy ${R + 6} u away (outside ${R}) is not touched`);
    const s2 = fresh();
    put(s2, 1, 600 + R - 4, 500); // just inside
    tap(s2);
    check(P(s2, 'vx', 1) > 300, `an enemy ${R - 4} u away (inside ${R}) is`);
}
{
    const sim = fresh();
    put(sim, 1, 640, 500);
    tap(sim);
    check(near(P(sim, 'cd.explode'), 12, 0.02), `cooldown starts: ${P(sim, 'cd.explode').toFixed(2)} s`);
    sim.run('players[1].vx = 0; players[1].vy = 0; players[1].x = 640; players[1].y = 500');
    tap(sim);
    check(Math.abs(P(sim, 'vx', 1)) < 5, 'pressing during the cooldown does nothing');
}

// the death ball and decoys are blasted too
{
    const sim = fresh();
    sim.run('ball.x = 640; ball.y = 500; ball.vx = ball.vy = 0; ball.w = 0'); // 40 u to the right
    tap(sim);
    check(near(sim.run('ball.vx'), KICK, 0.08) && Math.abs(sim.run('ball.vy')) < 60, `the death ball 40 u away is blasted straight away from you (vx ${sim.run('ball.vx').toFixed(0)}, vy ${sim.run('ball.vy').toFixed(0)})`);
    const far = fresh();
    far.run(`ball.x = ${600 + R + 8}; ball.y = 500; ball.vx = ball.vy = 0`);
    tap(far);
    check(Math.abs(far.run('ball.vx')) < 5, `the death ball ${R + 8} u away (outside ${R}) is not touched`);
    const d = fresh();
    d.run('spawnDecoy(players[1], 570, 470); decoys[0].vx = decoys[0].vy = 0'); // up and to the left, ~42 u
    tap(d);
    check(d.run('decoys[0].vx') < -300 && d.run('decoys[0].vy') < -300, `a decoy is blasted along the line from you (vx ${d.run('decoys[0].vx').toFixed(0)}, vy ${d.run('decoys[0].vy').toFixed(0)})`);
    const dfar = fresh();
    dfar.run(`spawnDecoy(players[1], ${600 + R + 8}, 500); decoys[0].vx = decoys[0].vy = 0`);
    tap(dfar);
    check(Math.abs(dfar.run('decoys[0].vx')) < 5, 'a decoy outside the radius is not touched');
    const both = fresh();
    both.run('ball.x = 640; ball.y = 500; ball.vx = ball.vy = 0; spawnDecoy(players[1], 560, 500); decoys[0].vx = decoys[0].vy = 0');
    put(both, 1, 600, 440);
    tap(both);
    check(sim.run('ball.vx') > 300 && both.run('ball.vx') > 300 && both.run('decoys[0].vx') < -300 && both.run('players[1].vy') < -300, 'players, ball and decoy are all blasted by the same press');
    const fast = fresh();
    fast.run('ball.x = 640; ball.y = 500; ball.vx = 800; ball.vy = 0');
    tap(fast);
    check(fast.run('ball.vx') > 1000, `a ball already flying away at 800 u/s is not clipped at the speed cap (${fast.run('ball.vx').toFixed(0)} u/s)`);
}

// 2v2: teammates are blasted too; deaths do not end the round, so the refund shows up in the cooldown itself
{
    const sim = fresh(2);
    check(P(sim, 'team', 2) === P(sim, 'team', 0) && P(sim, 'team', 1) !== P(sim, 'team', 0), 'scenario: players 0 and 2 are teammates, 1 and 3 the enemy');
    put(sim, 2, 560, 500); put(sim, 1, 640, 500); put(sim, 3, 900, 500);
    tap(sim);
    check(P(sim, 'vx', 2) < -300, `a teammate is blasted too (vx ${P(sim, 'vx', 2).toFixed(0)})`);
    check(Math.abs(P(sim, 'vx', 3)) < 5, 'a far-away player is not touched');
}
{
    const sim = fresh(2);
    put(sim, 1, 640, 500); put(sim, 3, 900, 500);
    tap(sim);
    ticks(sim, 1);
    killWithBall(sim, 1);
    check(!P(sim, 'alive', 1) && P(sim, 'alive', 3) && P(sim, 'alive'), 'scenario: an enemy died 1 s after the blast, the round goes on');
    check(P(sim, 'cd.explode') === 0, 'a death within 5 s resets the cooldown to zero');
    check(P(sim, 'exploCarry') === true, '(and marks the refund to carry into the next round)');
    sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false');
    check(near(P(sim, 'cd.explode'), 12, 0.02), 'so Explode can be used again at once');
}
{
    const sim = fresh(2);
    put(sim, 1, 640, 500); put(sim, 3, 900, 500);
    tap(sim);
    ticks(sim, 4.8);
    killWithBall(sim, 1);
    check(!P(sim, 'alive', 1) && P(sim, 'cd.explode') === 0, 'a death at 4.8 s still counts');
}
{
    const sim = fresh(2);
    put(sim, 1, 640, 500); put(sim, 3, 900, 500);
    tap(sim);
    ticks(sim, 5.3);
    killWithBall(sim, 1);
    check(!P(sim, 'alive', 1) && P(sim, 'cd.explode') > 5 && !P(sim, 'exploCarry'), `a death after 5 s does not (cooldown still ${P(sim, 'cd.explode').toFixed(1)} s)`);
}
{
    const sim = fresh(2);
    killWithBall(sim, 1); // a player is already dead before the blast
    sim.run('ball.reset()'); // (the ball back in its notch, off the next spot)
    put(sim, 3, 640, 500);
    tap(sim);
    ticks(sim, 1);
    check(P(sim, 'cd.explode') > 10, 'a death from before the blast does not count');
}

// 1v1: the death ends the round, and every round starts with cooldowns running, so the refund has to be carried over
{
    const sim = fresh();
    put(sim, 1, 640, 500);
    tap(sim);
    killWithBall(sim, 1);
    check(sim.run('pause') > 0 && P(sim, 'cd.explode') === 0, 'scenario: the kill ended the round (a point was scored) and the cooldown is zero');
    ticks(sim, 2.2);
    check(P(sim, 'alive', 1) && P(sim, 'cd.explode') === 0, 'next round: Explode starts ready (the refund carried over)');
    check(P(sim, 'exploCarry') === false, 'and the carry is used up');
    sim.run('players[0].reset()');
    check(near(P(sim, 'cd.explode'), 12, 0.02), 'the round after that starts with the normal full cooldown again');
}
{
    const sim = fresh();
    put(sim, 1, 640, 500);
    killWithBall(sim, 1); // a kill WITHOUT a blast
    ticks(sim, 2.2);
    check(P(sim, 'cd.explode') > 10, `control: a kill with no blast gives no head start (cooldown ${P(sim, 'cd.explode').toFixed(1)} s next round)`);
}
{
    const sim = fresh();
    sim.run('players[0].exploCarry = true');
    sim.run('resetMatch()');
    check(near(P(sim, 'cd.explode'), 12, 0.02), 'a new match never inherits a carried refund');
}

// save -> JSON -> load keeps the window
{
    const sim = fresh(2);
    put(sim, 1, 640, 500);
    tap(sim);
    ticks(sim, 1);
    const snap = JSON.parse(JSON.stringify(sim.save())), t = P(sim, 'exploT'), d = P(sim, 'exploDead');
    sim.run('players[0].exploT = 0; players[0].exploDead = 99'); sim.load(snap);
    check(Math.abs(P(sim, 'exploT') - t) < 1e-9 && P(sim, 'exploDead') === d, `save/load keeps the refund window (${P(sim, 'exploT').toFixed(2)} s left)`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
