// Headless tests for the Warp special. Run:  node test/warp-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };

function fresh() {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run("players[0].special = 'warp'");
    sim.run('pause = 0; players[0].cd.warp = 0'); // skip the opening cooldown unless a test wants it
    return sim;
}
const press = (sim, n = 1) => { sim.run('players[0].keys.sp = true'); for (let i = 0; i < n; i++) sim.tick(); sim.run('players[0].keys.sp = false'); sim.tick(); };
const P = (sim, expr) => sim.run('players[0].' + expr);

// 1. first press places a marker where you stand, no cooldown is spent
{
    const sim = fresh();
    sim.run('players[0].x = 200; players[0].y = 300; players[0].vx = 0; players[0].vy = 0');
    press(sim);
    const w = P(sim, 'warp');
    check(!!w && Math.abs(w.x - 200) < 1 && Math.abs(w.y - 300) < 80, `press 1 places a marker at the player (${w && w.x.toFixed(1)}, ${w && w.y.toFixed(1)})`);
    check(P(sim, 'cd.warp') === 0, 'placing costs no cooldown');
}

// 2. second press teleports, momentum kept, marker gone, 15 s cooldown
{
    const sim = fresh();
    sim.run('players[0].x = 200; players[0].y = 200; players[0].vx = 0; players[0].vy = 0');
    press(sim);
    const w = P(sim, 'warp');
    sim.run('players[0].x = 600; players[0].y = 150; players[0].vx = 240; players[0].vy = -90');
    sim.run('players[0].keys.sp = true');
    const before = { vx: P(sim, 'vx'), vy: P(sim, 'vy') };
    sim.tick();
    sim.run('players[0].keys.sp = false');
    sim.tick(); // key released for a tick, so the next press is a fresh key-down
    const x = P(sim, 'x'), y = P(sim, 'y'), vx = P(sim, 'vx'), vy = P(sim, 'vy');
    check(Math.hypot(x - w.x, y - w.y) < 8, `press 2 teleports to the marker (now ${x.toFixed(1)}, ${y.toFixed(1)}; marker ${w.x.toFixed(1)}, ${w.y.toFixed(1)})`);
    check(Math.abs(vx - before.vx) < 5 && Math.abs(vy - before.vy) < 10, `velocity kept (${before.vx.toFixed(0)},${before.vy.toFixed(0)}) -> (${vx.toFixed(0)},${vy.toFixed(0)})`);
    check(P(sim, 'warp') === null, 'marker is consumed');
    check(Math.abs(P(sim, 'cd.warp') - 15) < 0.05, `cooldown is 15 s (${P(sim, 'cd.warp').toFixed(2)})`);
    // cooldown blocks a re-teleport, but a new marker can still be placed
    press(sim);
    check(!!P(sim, 'warp'), 'a new marker can be placed while the cooldown runs');
    sim.run('players[0].x = 400; players[0].y = 100');
    press(sim);
    check(!!P(sim, 'warp') && Math.abs(P(sim, 'x') - 400) < 20, 'a second teleport during the cooldown does nothing; the marker waits');
    for (let i = 0; i < 15 * 120; i++) sim.tick();
    check(P(sim, 'cd.warp') === 0, 'cooldown runs out after 15 s');
}

// 3. the grapple survives the teleport (surface rope and ball tether)
{
    const sim = fresh();
    sim.run('players[0].x = 250; players[0].y = 500; players[0].vx = 0; players[0].vy = 0');
    press(sim);
    sim.run('players[0].x = 200; players[0].y = 480; players[0].vx = 100; players[0].vy = 0; ball.x = 800; ball.y = 100; ball.vx = ball.vy = 0');
    sim.run('players[0].keys.z = true');
    for (let i = 0; i < 40; i++) sim.tick();
    check(P(sim, 'rope') !== null, 'scenario: a surface rope is out before the warp');
    sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false');
    check(Math.abs(P(sim, 'x') - 250) < 10, 'warped while roped');
    for (let i = 0; i < 60; i++) sim.tick();
    check(P(sim, 'rope') !== null && P(sim, 'alive'), 'the surface rope is still out after the warp');
}
{
    const sim = fresh();
    sim.run('players[0].x = 260; players[0].y = 500; players[0].vx = 0; players[0].vy = 0');
    press(sim);
    sim.run('players[0].x = 200; players[0].y = 480; players[0].vx = 100; players[0].vy = 0; ball.x = 280; ball.y = 440; ball.vx = ball.vy = 0');
    sim.run('players[0].keys.z = true');
    for (let i = 0; i < 40; i++) sim.tick();
    check(P(sim, 'onBall') && P(sim, 'tball') !== null, 'scenario: tethered to the ball before the warp');
    sim.run('players[0].keys.sp = true'); sim.tick(); sim.run('players[0].keys.sp = false');
    for (let i = 0; i < 60; i++) sim.tick();
    check(P(sim, 'onBall') && P(sim, 'tball') !== null, 'the ball tether is still on after the warp');
}

// 4. crossing the net: the net guard must not drag the player back
{
    const sim = fresh();
    sim.run('players[0].x = 700; players[0].y = 550; players[0].vx = 0; players[0].vy = 0');
    press(sim);
    sim.run('players[0].x = 100; players[0].y = 550; players[0].netSide = 0'); // walked there legitimately: the net guard knows we are on the left
    for (let i = 0; i < 5; i++) sim.tick();
    press(sim);
    sim.tick(); sim.tick();
    check(Math.abs(P(sim, 'x') - 700) < 30, `warps across the net (x ${P(sim, 'x').toFixed(1)} of 700)`);
}

// 5. round reset clears marker, swapping special clears it, save/load keeps it
{
    const sim = fresh();
    sim.run('players[0].x = 300; players[0].y = 300');
    press(sim);
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('players[0].warp = null');
    sim.load(snap);
    check(!!P(sim, 'warp') && Math.abs(P(sim, 'warp.x') - 300) < 1, 'save -> JSON -> load keeps the marker');
    sim.run("players[0].special = 'dash'");
    sim.tick();
    check(P(sim, 'warp') === null, 'swapping to another special clears the marker');
    sim.run("players[0].special = 'warp'");
    press(sim);
    sim.run('players[0].reset()');
    check(P(sim, 'warp') === null, 'a new round clears the marker');
    check(Math.abs(P(sim, 'cd.warp') - 15) < 0.01, 'a new round starts with the full cooldown (START_CD), like every other special');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
