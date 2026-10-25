// Headless tests for the Fighter special: the two-slot rules, the motion recognizer, moves, hitboxes and save / load. Run:  node js/test/fighter-test.js
const { loadSim } = require('../server/sim-node.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const P = (sim, e, i = 0) => sim.run(`players[${i}].` + e);
const keys = (sim, o) => sim.run(`Object.assign(players[0].keys, { l: false, r: false, up: false, dn: false, z: false, x: false, sp: false, sp2: false }, ${JSON.stringify(o)})`);
const hold = (sim, o, n) => { keys(sim, o); for (let i = 0; i < n; i++) sim.tick(); };
function fresh(face = 1, two = true) {
    const sim = loadSim();
    sim.run('resetMatch()');
    sim.run(`twoSpecials = ${two}; pause = 0; ai.forEach(a => a.on = false); players[0].special = 'fighter'; players[0].special2 = 'fighter'; players[0].reset(); for (const k in players[0].cd) players[0].cd[k] = 0`);
    sim.run(`players[0].netSide = ${face > 0 ? 0 : 1}; players[0].x = ${face > 0 ? 250 : 700}; players[0].y = H - 16; players[0].vx = players[0].vy = 0; players[0].face = ${face}`);
    for (let i = 0; i < 5; i++) sim.tick(); // settle on the floor
    return sim;
}
const D = { dn: true }, DF = { dn: true, r: true }, F = { r: true }, B = { l: true }, DB = { dn: true, l: true };

console.log('\nthe two-slot rules');
{
    const sim = fresh();
    check(sim.run('JSON.stringify(players[0].slots())') === '[["sp","fighter"],["sp2","fighter"]]', 'Fighter takes both keys');
    check(sim.run("players[0].has('fighter')"), 'has(fighter) is true');
    sim.run("twoSpecials = false; players[0].special2 = 'plinko'");
    check(sim.run('JSON.stringify(players[0].slots())') === '[["sp","dash"]]', 'in a one-special match a stray Fighter counts as Dash');
    sim.run("twoSpecials = true; players[0].special = 'dash'; players[0].special2 = 'dash'; players[0].special2 = 'plinko'");
    sim.run("equipSpecial(players[0], 0, 'fighter')");
    check(P(sim, 'special') === 'fighter' && P(sim, 'special2') === 'fighter', 'equipping Fighter in either slot takes both');
    sim.run("equipSpecial(players[0], 1, 'arrow')");
    check(P(sim, 'special2') === 'arrow' && P(sim, 'special') !== 'fighter' && P(sim, 'special') !== 'arrow', 'equipping something else over it frees the other slot (' + P(sim, 'special') + ')');
    sim.run("twoSpecials = false; players[0].special = 'dash'; equipSpecial(players[0], 0, 'fighter')");
    check(P(sim, 'special') === 'dash', 'Fighter cannot be equipped in a one-special match');
    sim.run("twoSpecials = true; players[0].special = 'fighter'; players[0].special2 = 'fighter'; ai[0].on = true; equipSpecial(players[0], 0, 'plinko'); equipSpecial(players[0], 0, 'fighter')");
    check(P(sim, 'special') !== 'fighter', 'leaving it works, and a computer player cannot take it');
    sim.run("ai[0].on = false; twoSpecials = true; players[0].special = 'fighter'; players[0].special2 = 'fighter'; setTwoSpecials(false)");
    check(P(sim, 'special') === 'dash' && P(sim, 'special2') !== 'fighter', 'switching two-specials off turns Fighter into plain specials (' + P(sim, 'special') + ', ' + P(sim, 'special2') + ')');
}

console.log('\nthe recognizer');
{
    const ok = (hist, motion, face, now) => { const s = fresh(); s.ctx.__h = hist; return s.run(`fighterMotionOk(__h, '${motion}', ${face}, ${now})`); };
    // entries are [absolute direction, tick]; 6 = screen right
    const qcf = [[5, 0], [2, 10], [3, 16], [6, 22]];
    check(ok(qcf, '236', 1, 24), '2 3 6 is a quarter-circle forward');
    check(ok([[5, 0], [2, 10], [6, 16]], '236', 1, 18), 'the diagonal can be skipped: 2 6 counts');
    check(ok([[6, 5], [5, 8], [2, 12], [5, 14], [3, 16]], '623', 1, 18), 'a dragon punch with neutrals between the steps: 6 . 2 . 3');
    check(!ok([[5, 0], [6, 10], [2, 16], [3, 22]], '236', 1, 24), '6 2 3 is not a fireball (a dragon punch is not a quarter-circle)');
    check(!ok([[5, 0], [2, 10], [3, 16], [6, 22]], '623', 1, 24), 'and 2 3 6 is not a dragon punch');
    check(!ok([[5, 0], [3, 10], [6, 16]], '236', 1, 18), 'a straight step cannot be skipped: 3 6 is not enough');
    check(!ok([[5, 0], [2, 10], [3, 16], [6, 22], [4, 24]], '236', 1, 26), 'something pressed after the motion spoils it');
    check(ok([[5, 0], [4, 5], [1, 10], [2, 14]].concat([[3, 18], [6, 22]]).slice(2), '236', 1, 24) === true, 'junk before the motion is ignored');
    check(!ok([[2, 0], [3, 70], [6, 140]], '236', 1, 150), 'too slow: the motion has to be finished quickly (' + Math.round(0.35 * 120) + ' ticks)');
    check(!ok(qcf.concat([[5, 26]]), '236', 1, 56), 'and the button has to come soon after the motion (lead ' + Math.round(0.12 * 120) + ' ticks)');
    check(ok(qcf.concat([[5, 26]]), '236', 1, 32), 'a button pressed just after letting go of the keys still counts');
    check(ok([[5, 0], [2, 10], [1, 16], [4, 22]], '236', -1, 24), 'facing left the motion is mirrored: 2 1 4 is a quarter-circle FORWARD');
    check(!ok([[5, 0], [2, 10], [1, 16], [4, 22]], '236', 1, 24), '...and the same keys are nothing when facing right');
}

console.log('\nmoves');
{
    const sim = fresh();
    hold(sim, D, 6); hold(sim, DF, 6); hold(sim, F, 4);
    hold(sim, { r: true, sp2: true }, 1);
    check(P(sim, 'move') && P(sim, 'move.id') === 'rush', 'down, down-forward, forward + K starts RUSH (move: ' + JSON.stringify(P(sim, 'move')) + ')');
    let vmax = 0;
    for (let i = 0; i < 30; i++) { keys(sim, { r: true }); sim.tick(); vmax = Math.max(vmax, P(sim, 'vx')); }
    check(vmax > 400, 'RUSH lunges forward (peak vx ' + vmax.toFixed(0) + ')');
    for (let i = 0; i < 40; i++) { keys(sim, {}); sim.tick(); }
    check(P(sim, 'move') === null, 'the move ends after startup + active + recovery');
}
{
    const sim = fresh();
    hold(sim, F, 6); hold(sim, D, 6); hold(sim, DF, 4);
    hold(sim, { dn: true, r: true, sp: true }, 1);
    check(P(sim, 'move.id') === 'uppercut', 'forward, down, down-forward + P starts UPPERCUT');
    let vmin = 0;
    for (let i = 0; i < 20; i++) { keys(sim, {}); sim.tick(); vmin = Math.min(vmin, P(sim, 'vy')); }
    check(vmin < -300, 'UPPERCUT launches the fighter upward (peak vy ' + vmin.toFixed(0) + ')');
}
{
    const sim = fresh(-1);
    hold(sim, D, 6); hold(sim, DB, 6); hold(sim, B, 4);
    hold(sim, { l: true, sp2: true }, 1);
    check(P(sim, 'move.id') === 'rush' && P(sim, 'face') === -1, 'facing left, the same motion mirrored (down, down-back, back) is RUSH');
    let vmin = 0;
    for (let i = 0; i < 30; i++) { keys(sim, { l: true }); sim.tick(); vmin = Math.min(vmin, P(sim, 'vx')); }
    check(vmin < -400, 'and it lunges to the left (' + vmin.toFixed(0) + ')');
}
{
    const sim = fresh();
    hold(sim, { sp: true }, 1);
    check(P(sim, 'move.id') === 'jab', 'a plain P is JAB');
    hold(sim, { sp2: true }, 1);
    check(P(sim, 'move.id') === 'jab', 'a second press while a move runs does nothing');
    for (let i = 0; i < 30; i++) { keys(sim, {}); sim.tick(); }
    hold(sim, { sp2: true }, 1);
    check(P(sim, 'move.id') === 'kick', 'a plain K is KICK');
    for (let i = 0; i < 50; i++) { keys(sim, {}); sim.tick(); }
    hold(sim, F, 2); hold(sim, { r: true, sp: true }, 1);
    check(P(sim, 'move.id') === 'jab', 'a lone forward + P is only a JAB (no motion)');
    const x0 = P(sim, 'x'); let moved = false;
    for (let i = 0; i < 10; i++) { keys(sim, { r: true }); sim.tick(); }
    check(Math.abs(P(sim, 'x') - x0) < 8, 'steering is locked while a move runs (moved ' + (P(sim, 'x') - x0).toFixed(1) + ' u)');
}
{
    const sim = fresh();
    hold(sim, { sp: true }, 1);
    hold(sim, { l: true }, 2);
    check(P(sim, 'face') === 1, 'facing does not turn while a move is running');
    for (let i = 0; i < 40; i++) { keys(sim, {}); sim.tick(); }
    hold(sim, { l: true }, 2);
    check(P(sim, 'face') === -1, 'but it follows the last horizontal key afterwards');
}

console.log('\nhits');
{
    const sim = fresh();
    sim.run('ball.x = players[0].x + 45; ball.y = players[0].y; ball.vx = ball.vy = 0; ball.w = 0');
    hold(sim, { sp: true }, 1);
    for (let i = 0; i < 12; i++) { keys(sim, {}); sim.tick(); }
    check(P(sim, 'alive') && sim.run('ball.vx') > 100, 'JAB knocks the death ball forward (vx ' + sim.run('ball.vx').toFixed(0) + ') and the fighter lives');
    const v = sim.run('ball.vx');
    for (let i = 0; i < 6; i++) { keys(sim, {}); sim.tick(); }
    check(Math.abs(sim.run('ball.vx') - v) < 60, 'one move hits a target once (no repeat hits)');
}
{
    const sim = fresh();
    sim.run('players[1].netSide = 0; players[1].x = players[0].x + 52; players[1].y = players[0].y; players[1].vx = players[1].vy = 0');
    hold(sim, { sp2: true }, 1);
    for (let i = 0; i < 16; i++) { keys(sim, {}); sim.tick(); }
    check(P(sim, 'vx', 1) > 150 && P(sim, 'alive', 1), 'KICK knocks an enemy player back and does not kill them (vx ' + P(sim, 'vx', 1).toFixed(0) + ')');
}
{
    const sim = fresh(); // a hit behind the fighter does nothing
    sim.run('ball.x = players[0].x - 45; ball.y = players[0].y; ball.vx = ball.vy = 0; ball.w = 0');
    hold(sim, { sp: true }, 1);
    for (let i = 0; i < 12; i++) { keys(sim, {}); sim.tick(); }
    check(Math.abs(sim.run('ball.vx')) < 60, 'the hitbox is in front, so a ball behind is not hit');
}

console.log('\nstate');
{
    const sim = fresh();
    hold(sim, D, 6); hold(sim, DF, 6); hold(sim, F, 4); hold(sim, { r: true, sp2: true }, 1);
    for (let i = 0; i < 4; i++) { keys(sim, {}); sim.tick(); }
    const snap = JSON.parse(JSON.stringify(sim.save())), m = JSON.stringify(P(sim, 'move')), h = JSON.stringify(P(sim, 'dirHist'));
    sim.run('players[0].move = null; players[0].dirHist = []; players[0].face = -1'); sim.load(snap);
    check(JSON.stringify(P(sim, 'move')) === m && JSON.stringify(P(sim, 'dirHist')) === h && P(sim, 'face') === 1, 'save -> JSON -> load keeps the move, the history and the facing');
    const hist = P(sim, 'dirHist.length');
    sim.run("players[0].special = 'dash'; players[0].special2 = 'plinko'"); sim.tick();
    check(P(sim, 'move') === null && P(sim, 'dirHist.length') === 0, 'swapping away from Fighter clears the move and the history (had ' + hist + ' entries)');
    const s2 = fresh();
    for (let i = 0; i < 400; i++) { keys(s2, i % 20 < 10 ? F : B); s2.tick(); }
    check(P(s2, 'dirHist.length') <= 10, 'the history stays short (' + P(s2, 'dirHist.length') + ' entries after 400 ticks of switching direction)');
    s2.run('players[0].reset()');
    check(P(s2, 'move') === null && P(s2, 'dirHist.length') === 0, 'a new round clears them');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');

console.log('\nfireball');
{
    const sim = fresh();
    hold(sim, D, 6); hold(sim, DF, 6); hold(sim, F, 4); hold(sim, { r: true, sp: true }, 1);
    check(P(sim, 'move.id') === 'fireball', 'down, down-forward, forward + P starts FIREBALL');
    for (let i = 0; i < 20; i++) { keys(sim, {}); sim.tick(); }
    check(sim.run('fireballs.length') === 1 && sim.run('fireballs[0].vx') > 400, 'a fireball is out and flying forward');
    const snap = JSON.parse(JSON.stringify(sim.save()));
    sim.run('fireballs.length = 0'); sim.load(snap);
    check(sim.run('fireballs.length') === 1 && sim.run('fireballs[0].owner === players[0]'), 'save -> JSON -> load keeps it, with its owner');
    sim.run('ball.x = fireballs[0].x + 70; ball.y = fireballs[0].y; ball.vx = ball.vy = 0; ball.w = 0');
    for (let i = 0; i < 30; i++) { keys(sim, {}); sim.tick(); }
    check(sim.run('ball.vx') > 300 && sim.run('fireballs.length') === 0 && P(sim, 'alive'), 'it knocks the death ball forward and is used up');
}
{
    const sim = fresh();
    hold(sim, D, 6); hold(sim, DF, 6); hold(sim, F, 4); hold(sim, { r: true, sp: true }, 1);
    for (let i = 0; i < 20; i++) { keys(sim, {}); sim.tick(); }
    sim.run('fireballs[0].x = W - 10'); sim.tick();
    check(sim.run('fireballs.length') === 0, 'a fireball that reaches a wall disappears');
}

process.exit(fails ? 1 : 0);
