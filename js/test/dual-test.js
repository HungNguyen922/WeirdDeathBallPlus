// Headless tests for casting both specials at once. Run:  node js/test/dual-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const ticks = (sim, n) => { for (let i = 0; i < n; i++) sim.tick(); };
const P = (sim, e) => sim.run('players[0].' + e);
function fresh(a, b) {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run(`twoSpecials = true; pause = 0; players[0].special = '${a}'; players[0].special2 = '${b}'; players[0].reset(); for (const k in players[0].cd) players[0].cd[k] = 0`);
    sim.run('players[0].netSide = 1; players[0].x = 600; players[0].y = 500; players[0].vx = players[0].vy = 0');
    return sim;
}

{ // an arrow charges while Explode goes off on the other key
    const sim = fresh('arrow', 'explode');
    sim.run('players[0].keys.sp = true'); ticks(sim, 30);
    check(P(sim, 'casts.length') === 1 && P(sim, 'casts[0].type') === 'arrow' && P(sim, 'casts[0].charge') > 0, 'arrow is charging');
    sim.run('players[0].keys.sp2 = true'); ticks(sim, 2); sim.run('players[0].keys.sp2 = false'); ticks(sim, 2);
    check(P(sim, 'explodeFx') !== null && P(sim, 'cd.explode') > 0, 'Explode fired on the second key mid-charge');
    check(P(sim, 'casts.length') === 1 && P(sim, 'casts[0].type') === 'arrow', 'the arrow is still charging');
    sim.run('players[0].keys.sp = false'); ticks(sim, 4);
    check(sim.run('arrows.length') === 1, 'releasing the first key still fires the arrow');
}
{ // barbwire and an arrow charge together
    const sim = fresh('arrow', 'barbwire');
    sim.run('players[0].keys.sp = true'); ticks(sim, 10);
    sim.run('players[0].keys.sp2 = true'); ticks(sim, 4);
    check(P(sim, 'casts.length') === 2 && P(sim, 'casts.map(c => c.type).sort().join()') === 'arrow,barbwire', 'arrow and barbwire both running (' + P(sim, 'casts.map(c => c.type)') + ')');
    sim.run('players[0].keys.sp2 = false'); ticks(sim, 4);
    check(P(sim, 'casts.length') === 1 && P(sim, 'casts[0].type') === 'arrow', 'letting go of barbwire ends only barbwire');
}
{ // two aiming casts are refused
    const sim = fresh('arrow', 'bat');
    sim.run('players[0].keys.sp = true'); ticks(sim, 10);
    sim.run('players[0].keys.sp2 = true'); ticks(sim, 4);
    check(P(sim, 'casts.length') === 1 && P(sim, 'casts[0].type') === 'arrow' && P(sim, 'cd.bat') === 0, 'a bat cannot start while an arrow is being aimed');
}
{ // toggle off: the second key does nothing
    const sim = fresh('arrow', 'explode');
    sim.run('twoSpecials = false');
    sim.run('players[0].keys.sp2 = true'); ticks(sim, 4);
    check(P(sim, 'explodeFx') === null, 'with the toggle off the second key does nothing');
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);