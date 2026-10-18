// Headless tests for the Smoke Screen special (the sim side: the cloud's timer and cooldown; what it hides is drawn in render/smoke.js). Run:  node js/test/smoke-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const fresh = () => { const sim = loadSim(); sim.run('resetMatch()'); sim.run("players[0].special = 'smoke'; pause = 0; players[0].cd.smoke = 0"); return sim; };
const P = (sim, e) => sim.run('players[0].' + e);
const press = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
const T = 'SMOKE_T', CD = 'SMOKE_COOLDOWN';

{
    const sim = fresh();
    check(sim.run('SMOKE_R') === 8 * 32, `the cloud is 8 player lengths in radius (${sim.run('SMOKE_R')} u)`);
    press(sim);
    check(Math.abs(P(sim, 'smokeT') - sim.run(T)) < 0.05, `pressing starts the cloud (${P(sim, 'smokeT').toFixed(2)} s)`);
    check(P(sim, 'cd.smoke') === 0, 'no cooldown while it is out');
    ticks(sim, 2);
    const left = P(sim, 'smokeT');
    press(sim);
    check(P(sim, 'smokeT') < left, 'pressing again while it is out does nothing (the timer just keeps running)');
    ticks(sim, sim.run(T) - 2 + 0.1);
    check(P(sim, 'smokeT') === 0 && P(sim, 'cd.smoke') <= sim.run(CD) && P(sim, 'cd.smoke') > sim.run(CD) - 0.3, `when it clears the cooldown starts (${P(sim, 'cd.smoke').toFixed(1)} s)`);
    press(sim);
    check(P(sim, 'smokeT') === 0, 'no new cloud during the cooldown');
    ticks(sim, sim.run(CD) + 0.1);
    press(sim);
    check(P(sim, 'smokeT') > 0, 'and a new one after it');
}
{
    const sim = fresh();
    press(sim);
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('players[0].smokeT = 0'); sim.load(snap);
    check(P(sim, 'smokeT') > 0, 'save -> JSON -> load keeps the cloud');
    sim.run("players[0].special = 'dash'"); sim.tick();
    check(P(sim, 'smokeT') === 0 && P(sim, 'cd.smoke') === 0, 'switching special ends it, with no cooldown');
}
{
    const sim = fresh();
    press(sim);
    sim.run('players[0].smokeT = 3; players[0].reset()');
    check(P(sim, 'smokeT') === 0 && Math.abs(P(sim, 'cd.smoke') - sim.run(CD) * sim.run('START_CD')) < 0.01, 'a new round clears it and starts with the usual opening cooldown');
}
{
    const sim = fresh();
    sim.run("players[0].special = 'smoke'; players[1].special = 'dash'");
    const before = sim.run('players[1].x');
    press(sim); ticks(sim, 1);
    check(sim.run('players[1].x') === before, 'the cloud changes nothing in the physics (the other player is untouched)');
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
