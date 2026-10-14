// Headless tests for arrows reacting to Explode, the bat and players. Run:  node js/test/arrow-impulse-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const ticks = (sim, n) => { for (let i = 0; i < n; i++) sim.tick(); };
function fresh(special) {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run(`pause = 0; players[0].special = '${special}'; players[0].reset(); for (const k in players[0].cd) players[0].cd[k] = 0; players[0].netSide = 1; players[0].x = 600; players[0].y = 500; players[0].vx = players[0].vy = 0`);
    return sim;
}
const addArrow = (sim, x, y, vx, vy, team = 1, extra = '') => sim.run(`arrows.push({ x: ${x}, y: ${y}, vx: ${vx}, vy: ${vy}, ang: 0, team: ${team}, owner: players[1], stuck: false, life: 10, r: ARROW_R, immune: 0, ghost: 0 ${extra} })`);

{ // Explode pushes a flying arrow away from the caster
    const sim = fresh('explode');
    addArrow(sim, 640, 500, 0, 0);
    sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false');
    check(sim.run('arrows[0].vx') > 400, 'Explode kicks a loose arrow away (vx ' + sim.run('arrows[0].vx').toFixed(0) + ')');
}
{ // Explode dislodges a stuck arrow
    const sim = fresh('explode');
    addArrow(sim, 640, 500, 0, 0, 1, ', stuck: true');
    sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false');
    check(!sim.run('arrows[0].stuck') && sim.run('arrows[0].vx') > 400, 'Explode pulls a stuck arrow free and sends it flying');
}
{ // the bat sends an arrow along the aim and hands it to the batter's team
    const sim = fresh('bat');
    addArrow(sim, 640, 500, 0, 0);
    sim.run('players[0].keys.r = true; players[0].keys.sp = true'); ticks(sim, 4);
    sim.run('players[0].keys.sp = false'); ticks(sim, 40);
    check(sim.run('arrows[0].vx') > 300 && sim.run('arrows[0].team') === 0, 'a bat hit sends the arrow along the aim and makes it the batter\'s (vx ' + sim.run('arrows[0].vx').toFixed(0) + ', team ' + sim.run('arrows[0].team') + ')');
}
{ // a player running into a teammate's arrow pushes it
    const sim = fresh('dash');
    addArrow(sim, 640, 500, 0, 0, 0);
    sim.run('arrows[0].owner = players[0]; arrows[0].life = 5; players[0].vx = 300');
    sim.run('players[0].keys.r = true'); ticks(sim, 30);
    check(sim.run('arrows[0].vx') > 100, 'running into your own arrow bumps it (vx ' + sim.run('arrows[0].vx').toFixed(0) + ')');
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
