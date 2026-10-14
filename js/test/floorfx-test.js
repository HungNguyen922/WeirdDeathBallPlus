// Headless tests for Hyper / Xeric / Stun (see the FLOOR WEIGHT block in physics/constants.js). Run:  node js/test/floorfx-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
function fresh() {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run('pause = 0; pick.on = false; ai.forEach(a => a.on = false); players[0].x = 200; players[1].x = 720; players.forEach(p => { p.vx = 0; p.vy = 0; })');
    return sim;
}
// Peak height (lowest y reached) of player 1 doing a grapple jump from the floor, while player 0 does `other` (code run each tick before ticking).
function peak(setup, weighted) {
    const sim = fresh();
    let top = 1e9;
    sim.run(`players[1].keys.z = true; players[1].keys.x = ${weighted}`);
    for (let t = 0; t < 120; t++) {
        setup(sim, t);
        sim.tick();
        top = Math.min(top, P(sim, 'y', 1));
    }
    return top;
}
const idle = () => {};
const hyper = sim => sim.run('players[0].keys.x = true; players[0].keys.z = true');
const xeric = sim => sim.run('players[0].keys.x = true; players[0].keys.z = false');

// 1) HYPER: another player's weight+grapple on the floor makes my grapple jump go higher
{
    const base = peak(idle, false), hy = peak(hyper, false);
    check(hy < base - 5, `hyper: grapple jump peak y ${hy.toFixed(0)} vs ${base.toFixed(0)} without (higher = smaller y)`);
}
// 2) XERIC: another player holding weight on the floor wrecks my WEIGHTED grapple jump, leaves an unweighted one alone
{
    const base = peak(idle, true), xe = peak(xeric, true), plain = peak(idle, false), plainX = peak(xeric, false);
    check(xe > base + 10, `xeric: weighted grapple jump peak y ${xe.toFixed(0)} vs ${base.toFixed(0)} without (lower = smaller jump)`);
    check(Math.abs(plainX - plain) < 1, `xeric: an unweighted grapple jump is untouched (${plainX.toFixed(1)} vs ${plain.toFixed(1)})`);
}
// 3) the owner is never affected by their own auras
{
    const a = peak(idle, false);
    const sim = fresh(); let top = 1e9;
    sim.run('players[0].keys.z = true; players[0].keys.x = false');
    for (let t = 0; t < 120; t++) { sim.tick(); top = Math.min(top, P(sim, 'y', 0)); }
    check(Math.abs(top - a) < 40, `my own jump is a normal jump (${top.toFixed(0)} vs ${a.toFixed(0)}, mirror-side spawn)`);
}
// 4) STUN combo: hyper then a quick xeric stuns a player in the air off a floor grapple
function stunScenario(order) {
    const sim = fresh();
    sim.run('players[1].keys.z = true');
    ticks(sim, 0.12); // player 1 is up in the air on a floor rope
    const airborne = !P(sim, 'ground', 1) && P(sim, 'rope', 1) !== null;
    sim.run('players[0].keys.x = true');
    if (order === 'xeric-first') { ticks(sim, 0.1); sim.run('players[0].keys.z = true'); ticks(sim, 0.01); }
    else { sim.run('players[0].keys.z = true'); ticks(sim, 0.02); sim.run('players[0].keys.z = false'); ticks(sim, 0.01); }
    return { sim, airborne };
}
for (const order of ['hyper-first', 'xeric-first']) {
    const { sim, airborne } = stunScenario(order);
    check(airborne, `${order}: the target is in the air on a floor rope before the stun combo`);
    check(P(sim, 'stunT', 1) > 0 && P(sim, 'rope', 1) === null, `${order}: the combo stuns them (stunT ${P(sim, 'stunT', 1).toFixed(2)}, rope dropped)`);
    check(P(sim, 'stunFx', 0) > 0 && P(sim, 'stunT', 0) === 0, `${order}: the owner is not stunned and shows the shockwave`);
    sim.run('players[1].keys.up = true'); ticks(sim, 0.1);
    check(P(sim, 'rope', 1) === null, `${order}: stunned player cannot latch a new hook while holding grapple`);
}
// 5) stun ends on landing, then immunity stops a second stun straight away
{
    const { sim } = stunScenario('hyper-first');
    sim.run('players[0].keys.x = false; players[0].keys.z = false; players[1].keys.z = false');
    let landed = -1;
    for (let t = 0; t < 600 && landed < 0; t++) { sim.tick(); if (P(sim, 'ground', 1)) landed = t; }
    ticks(sim, 0.02);
    check(landed >= 0 && P(sim, 'stunT', 1) === 0 && P(sim, 'stunImm', 1) > 0, `stun ends on landing (after ${(landed / 120).toFixed(2)} s) and immunity starts (${P(sim, 'stunImm', 1).toFixed(2)} s)`);
    sim.run('players[1].stun()'); // (a direct call still works; immunity is checked by stunOthers())
    sim.run('players[1].stunT = 0'); sim.run('players[0].stunCd = 0; players[1].y = 300; players[1].ground = false; players[1].gjT = 0; players[0].stunOthers()');
    check(P(sim, 'stunT', 1) === 0, 'an immune player is not stunned again');
}
// 6) no stun without a combo: weight alone, hyper alone, and a long-held weight followed by grapple
{
    for (const [name, steps] of [['weight alone', s => s.run('players[0].keys.x = true')], ['hyper alone', s => s.run('players[0].keys.x = true; players[0].keys.z = true')]]) {
        const sim = fresh(); sim.run('players[1].keys.z = true'); ticks(sim, 0.12); steps(sim); ticks(sim, 0.04);
        check(P(sim, 'stunT', 1) === 0, `${name}: no stun`);
    }
    const sim = fresh(); sim.run('players[1].keys.z = true'); ticks(sim, 0.12);
    sim.run('players[0].keys.x = true'); ticks(sim, 0.8); sim.run('players[0].keys.z = true'); ticks(sim, 0.02);
    check(P(sim, 'stunT', 1) === 0, 'weight held a long time, then grapple: not a "quick" follow-up, no stun');
}
// 7) XERIC vs the seesaw: the same pop gives a xeric player a much smaller kick
{
    const kick = xer => {
        const sim = fresh();
        sim.run('players[1].x = 840; players[1].y = H - players[1].r; players[1].keys.x = ' + xer);
        ticks(sim, 0.3);
        sim.run('sawHit(100, 2000)'); // a slam on the far left raises the right far half
        let top = 0;
        for (let t = 0; t < 40; t++) { sim.tick(); top = Math.max(top, -P(sim, 'vy', 1)); }
        return top;
    };
    const plain = kick(false), xe = kick(true);
    check(plain > 20 && xe < plain * 0.5, `xeric soaks up the seesaw pop: peak upward speed ${xe.toFixed(0)} vs ${plain.toFixed(0)} u/s`);
}
// 8) save / load keeps everything
{
    const { sim } = stunScenario('hyper-first');
    const snap = JSON.parse(JSON.stringify(sim.save())), s = P(sim, 'stunT', 1);
    sim.run('players[1].stunT = 0; players[0].stunFx = 0'); sim.load(snap);
    check(Math.abs(P(sim, 'stunT', 1) - s) < 1e-9 && P(sim, 'stunFx', 0) > 0, 'save/load keeps the stun and the shockwave effect');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
