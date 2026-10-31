// Headless tests for the Accelerator special (physics/statics.js + physics/accelerator.js). Run:  node js/test/accelerator-test.js
// A accelerator speeds up its owner (and the ball / decoys the owner grappled last); it leaves enemies and other people's balls alone.
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const K = loadSim(), C = n => K.run(n);
const MAX = C('ACCELERATOR_MAX'), BOOST = C('ACCELERATOR_BOOST'), CD = C('ACCELERATOR_COOLDOWN'), MATES = C('ACCELERATOR_BOOST_TEAMMATES');
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const ticks = (sim, s) => { for (let i = 0; i < Math.round(s * 120); i++) sim.tick(); };
const tap = sim => { sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const at = (sim, x, y) => sim.run(`players[0].netSide = 0; players[0].x = ${x}; players[0].y = ${y}; players[0].vx = players[0].vy = 0`);
const place = (sim, x, y) => { at(sim, x, y); tap(sim); ticks(sim, CD + 0.1); };
const nodes = sim => sim.run("statics.filter(s => s.type === 'accelerator').map(s => [s.x, s.y, s.id])");
const lines = sim => sim.run("(() => { let n = 0; for (const s of statics) for (const o of statics) if (s.type === 'accelerator' && o.type === 'accelerator' && o.owner === s.owner && o.id < s.id) n++; return n; })()");
function fresh(size = 1) {
    const sim = loadSim();
    if (size === 2) sim.run('setTeamSize(2)'); else sim.run('resetMatch()');
    sim.run("players[0].special = 'accelerator'; players[0].reset(); pause = 0; players[0].cd.accelerator = 0");
    return sim;
}
function twoNodes(size = 1) { // a vertical line at x = 300 from y = 150 to y = 450, with the owner out of the way
    const sim = fresh(size);
    place(sim, 300, 150);
    place(sim, 300, 450);
    at(sim, 100, 600);
    return sim;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fly = (sim, i) => sim.run(`Object.assign(players[${i}], { netSide: 0, ground: false, x: 299.5, y: 300, vx: 200, vy: 0 })`);
const ballFly = (sim, grabber, y = 300) => sim.run(`ball.lastGrab = ${grabber}; ball.x = 299.5; ball.y = ${y}; ball.vx = 200; ball.vy = 0; ball.w = 0`);
console.log(`  info max ${MAX} nodes, boost +${BOOST * 100}% per crossing, cooldown ${CD} s, teammates ${MATES ? 'boosted' : 'not boosted'}`);

console.log('\nplacing nodes');
{
    const sim = fresh();
    at(sim, 300, 200); tap(sim);
    const n = nodes(sim);
    check(n.length === 1 && near(n[0][0], 300, 0.01) && near(n[0][1], 200, 0.01), 'the first press drops a node where you stand');
    check(P(sim, 'cd.accelerator') > CD - 0.05 && P(sim, 'cd.accelerator') <= CD, `the cooldown starts (${P(sim, 'cd.accelerator').toFixed(2)} s)`);
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

console.log('\nwho is sped up');
{
    const sim = twoNodes();
    fly(sim, 0);
    sim.tick();
    const v = P(sim, 'vx');
    check(near(v, 200 * (1 + BOOST), 3), `the owner gains ${BOOST * 100}% crossing their own line (200 -> ${v.toFixed(1)})`);
    check(sim.run('statics[0].flash') > 0 || sim.run('statics[1].flash') > 0, 'the line lights up');
    ticks(sim, 0.2);
    check(P(sim, 'vx') > 200 * (1 + BOOST) - 6 && P(sim, 'vx') < 200 * (1 + BOOST) + 1, 'and only once: it is not boosted again on the far side');
}
{
    const sim = twoNodes();
    fly(sim, 1);
    sim.tick();
    const v = P(sim, 'vx', 1);
    check(near(v, 199.8, 1), `an enemy crossing the line is NOT changed (200 -> ${v.toFixed(1)})`);
}
{
    const sim = twoNodes(2);
    fly(sim, 2);
    sim.tick();
    const v = P(sim, 'vx', 2), want = MATES ? 200 * (1 + BOOST) : 199.8;
    check(near(v, want, 3), `a teammate is ${MATES ? 'boosted' : 'not boosted'} (ACCELERATOR_BOOST_TEAMMATES = ${MATES}): 200 -> ${v.toFixed(1)}`);
}
{
    const sim = twoNodes();
    ballFly(sim, 0);
    sim.tick();
    const v = sim.run('ball.vx');
    check(near(v, 200 * (1 + BOOST), 3), `the death ball gains ${BOOST * 100}% when the OWNER grappled it last (200 -> ${v.toFixed(1)})`);
}
{
    const sim = twoNodes();
    ballFly(sim, 1);
    sim.tick();
    check(near(sim.run('ball.vx'), 199.9, 1), 'the ball is not boosted when the enemy grappled it last');
    ballFly(sim, -1);
    sim.tick();
    check(near(sim.run('ball.vx'), 199.9, 1), 'nor when nobody has grappled it');
}
{
    const sim = twoNodes();
    ballFly(sim, 0, 540); // below the end of the line: it passes under it
    sim.tick();
    check(near(sim.run('ball.vx'), 199.9, 1), 'passing the line beyond its end changes nothing');
}
{
    const sim = fresh();
    place(sim, 300, 150);
    at(sim, 100, 600);
    ballFly(sim, 0, 150); // right through the only node: one node has no line
    sim.tick();
    check(near(sim.run('ball.vx'), 199.9, 1), 'a single node has no line, so nothing is boosted');
}

console.log('\nthe last grappler');
{
    const sim = fresh();
    check(sim.run('ball.lastGrab') === -1, 'at the start of a round nobody has grappled the ball');
    sim.run('players[0].netSide = 0; players[0].x = 100; players[0].y = 300; players[0].vx = players[0].vy = 0; ball.x = 140; ball.y = 300; ball.vx = ball.vy = 0; players[0].attach(ball)');
    check(P(sim, 'onBall') === true && sim.run('ball.lastGrab') === 0, 'grappling the ball makes you its last grappler');
    sim.run('players[0].rope = null; players[0].onBall = false; players[0].tball = null'); // let go
    check(sim.run('ball.lastGrab') === 0, 'and letting go does not undo that');
    place(sim, 300, 150);
    place(sim, 300, 450);
    at(sim, 100, 600);
    sim.run('ball.x = 299.5; ball.y = 300; ball.vx = 200; ball.vy = 0; ball.w = 0'); // (lastGrab is left exactly as the grapple set it)
    sim.tick();
    check(near(sim.run('ball.vx'), 200 * (1 + BOOST), 3), 'so the ball is boosted crossing the accelerator after a real grapple and release');
    sim.run('ball.lastGrab = 1');
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('ball.lastGrab = 5'); sim.load(snap);
    check(sim.run('ball.lastGrab') === 1, 'save -> JSON -> load keeps it');
    sim.run('newRound()');
    check(sim.run('ball.lastGrab') === -1, 'and a new round forgets it');
}

console.log('\nstate');
{
    const sim = twoNodes();
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('statics.length = 0');
    sim.load(snap);
    check(nodes(sim).length === 2 && sim.run('statics.every(s => s.owner === players[0])'), 'save -> JSON -> load keeps the nodes and their owner');
    fly(sim, 0);
    sim.tick();
    check(near(P(sim, 'vx'), 200 * (1 + BOOST), 3), 'and the loaded accelerator still speeds its owner up');
    sim.run('newRound()');
    check(nodes(sim).length === 0, 'a new round clears the accelerator');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
