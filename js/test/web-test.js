// Headless tests for the Web special (physics/statics.js + physics/web.js). Run:  node js/test/web-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const K = loadSim(), C = n => K.run(n);
const MAX = C('WEB_MAX'), SLOW = C('WEB_SLOW'), CD = C('WEB_COOLDOWN');
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
const tap = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const at = (sim, x, y) => sim.run(`players[0].netSide = 0; players[0].x = ${x}; players[0].y = ${y}; players[0].vx = players[0].vy = 0`);
const place = (sim, x, y) => { at(sim, x, y); tap(sim); ticks(sim, CD + 0.1); };
const nodes = sim => sim.run("statics.filter(s => s.type === 'web').map(s => [s.x, s.y, s.id])");
const lines = sim => sim.run("(() => { let n = 0; for (const s of statics) for (const o of statics) if (s.type === 'web' && o.type === 'web' && o.owner === s.owner && o.id < s.id) n++; return n; })()");
function fresh() {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run("players[0].special = 'web'; players[0].reset(); pause = 0; players[0].cd.web = 0");
    return sim;
}
function twoNodes() { // a vertical line at x = 300 from y = 150 to y = 450, with the owner out of the way
    const sim = fresh();
    place(sim, 300, 150);
    place(sim, 300, 450);
    at(sim, 100, 600);
    return sim;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
console.log(`  info max ${MAX} nodes, slow ${SLOW * 100}% per crossing, cooldown ${CD} s`);

console.log('\nplacing nodes');
{
    const sim = fresh();
    at(sim, 300, 200); tap(sim);
    const n = nodes(sim);
    check(n.length === 1 && near(n[0][0], 300, 0.01) && near(n[0][1], 200, 0.01), 'the first press drops a node where you stand');
    check(P(sim, 'cd.web') > CD - 0.05 && P(sim, 'cd.web') <= CD, `the cooldown starts (${P(sim, 'cd.web').toFixed(2)} s)`);
    at(sim, 400, 200); tap(sim);
    check(nodes(sim).length === 1, 'pressing during the cooldown does nothing');
    ticks(sim, CD + 0.1);
    at(sim, 400, 200); tap(sim);
    check(nodes(sim).length === 2 && lines(sim) === 1, 'the next press adds a node and one line');
}
{
    const sim = fresh();
    for (let i = 0; i < MAX; i++) place(sim, 60 + 50 * i, 200);
    check(nodes(sim).length === MAX && lines(sim) === MAX * (MAX - 1) / 2, `${MAX} nodes make ${MAX * (MAX - 1) / 2} lines (every node joined to every older one)`);
    const before = nodes(sim).map(n => n[2]);
    place(sim, 360, 150);
    const after = nodes(sim).map(n => n[2]);
    check(after.length === MAX && !after.includes(before[0]) && after.includes(before[1]), 'a further press replaces the OLDEST node');
    check(lines(sim) === MAX * (MAX - 1) / 2, 'and the line count stays the same');
}

console.log('\ncrossing a line');
{
    const sim = twoNodes();
    sim.run('ball.x = 299.5; ball.y = 300; ball.vx = 200; ball.vy = 0; ball.w = 0');
    sim.tick();
    const v = sim.run('ball.vx');
    check(near(v, 200 * (1 - SLOW), 3), `the death ball loses ${SLOW * 100}% crossing the line (200 -> ${v.toFixed(1)})`);
    ticks(sim, 0.2);
    check(sim.run('ball.vx') > 200 * (1 - SLOW) - 6, 'and only once: it is not cut again on the far side');
    check(sim.run('statics[0].flash') > 0 || sim.run('statics[1].flash') > 0, 'the line lights up');
}
{
    const sim = twoNodes();
    sim.run('ball.x = 299.5; ball.y = 540; ball.vx = 200; ball.vy = 0; ball.w = 0'); // below the end of the line: it passes under it
    sim.tick();
    check(sim.run('ball.vx') > 199, 'passing the line beyond its end changes nothing');
}
{
    const sim = twoNodes();
    sim.run('players[1].netSide = 0; players[1].ground = false; players[1].x = 299.5; players[1].y = 300; players[1].vx = 200; players[1].vy = 0');
    sim.tick();
    const v = P(sim, 'vx', 1);
    check(near(v, 200 * (1 - SLOW), 3), `an enemy player is slowed too (200 -> ${v.toFixed(1)})`);
    if (C('WEB_HITS_OWN_TEAM')) {
        sim.run('players[0].netSide = 0; players[0].ground = false; players[0].x = 299.5; players[0].y = 300; players[0].vx = 200; players[0].vy = 0');
        sim.tick();
        check(near(P(sim, 'vx'), 200 * (1 - SLOW), 3), 'and so is the owner (WEB_HITS_OWN_TEAM)');
    }
}
{
    const sim = fresh();
    place(sim, 300, 150);
    at(sim, 100, 600);
    sim.run('ball.x = 299.5; ball.y = 150; ball.vx = 200; ball.vy = 0; ball.w = 0'); // right through the only node: one node has no line
    sim.tick();
    check(sim.run('ball.vx') > 199, 'a single node has no line, so nothing is slowed');
}

console.log('\nstate');
{
    const sim = twoNodes();
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('statics.length = 0');
    sim.load(snap);
    check(nodes(sim).length === 2 && sim.run('statics.every(s => s.owner === players[0])'), 'save -> JSON -> load keeps the nodes and their owner');
    sim.run('ball.x = 299.5; ball.y = 300; ball.vx = 200; ball.vy = 0; ball.w = 0');
    sim.tick();
    check(near(sim.run('ball.vx'), 200 * (1 - SLOW), 3), 'and the loaded web still slows things');
    sim.run('newRound()');
    check(nodes(sim).length === 0, 'a new round clears the web');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
