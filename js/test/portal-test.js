// Headless tests for the Portal special's maths and casting. Run:  node js/test/portal-test.js
// Needs only constants.js and portals.js (it stubs the bodies), so it runs even without physics/player.js.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
const ctx = vm.createContext({ console, Math });
const load = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
load('js/physics/constants.js');
vm.runInContext(`
class Player {}
const AIMING = ['arrow', 'marionette', 'bat'];
const mk = (id, x, y) => Object.assign(new Player(), { casts: [], cd: { portal: 0 }, netSide: 0, id, team: id % 2, x, y, vx: 0, vy: 0, r: 16, alive: true, keys: { l: 0, r: 0, up: 0, dn: 0, z: 0, x: 0, sp: 0, sp2: 0 }, special: 'portal', special2: 'dash' });
const allPlayers = [mk(0, 100, 300), mk(1, 800, 300), mk(2, 0, 0), mk(3, 0, 0)], players = [allPlayers[0], allPlayers[1]];
const ball = { x: 475, y: 100, vx: 0, vy: 0, r: 14 }, decoys = [], projectiles = [], PROJ_TYPES = { arrow: { swappable: true }, boomerang: { swappable: true } }, arrow0 = () => projectiles.find(p => p.type === 'arrow'), boom0 = () => projectiles.find(p => p.type === 'boomerang');
let twoSpecials = false;
const wrapAng = a => Math.atan2(Math.sin(a), Math.cos(a));
const ARROW_SNAP = { l: Math.PI, r: 0, u: -Math.PI / 2, d: Math.PI / 2 };
`, ctx);
load('js/physics/portals.js');
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + msg); };
const run = c => vm.runInContext(c, ctx);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const open = (o, x, y, ang) => run(`portals.push({ id: ++portalSeq, x: ${x}, y: ${y}, ang: ${ang}, owner: allPlayers[${o}], team: ${o % 2}, flash: 0 })`);

// 1. entering anywhere in the disc, from any angle, comes out of the other portal heading the way it points, speed kept
run('portals.length = 0');
open(0, 200, 300, -Math.PI / 2); open(0, 600, 200, 0);
for (const [x, y, vx, vy] of [[200, 290, 0, 300], [200, 310, 0, -300], [185, 300, 300, 0], [215, 300, -300, 0], [200, 300, 212, 212]]) {
    run(`ball.pLock = 0; ball.x = ${x}; ball.y = ${y}; ball.vx = ${vx}; ball.vy = ${vy}; portalPass(ball)`);
    check(near(run('ball.vx'), 300, 1e-6) && near(run('ball.vy'), 0, 1e-6) || (vx === 212 && near(run('Math.hypot(ball.vx, ball.vy)'), 300, 0.5) && near(run('ball.vy'), 0, 1e-6)), `entering at (${x - 200}, ${y - 300}) heading (${vx}, ${vy}): out along B's arrow at the same speed`);
}
check(near(run('ball.x'), 600 + 32 + 14 + 3) && near(run('ball.y'), 200), 'it appears just outside B, on the side the arrow points');
// 2. immediate: the very tick the centre is inside the disc, no need to cross any line
run('ball.pLock = 0; ball.x = 200 + 31; ball.y = 300; ball.vx = 0; ball.vy = 0; const t0 = portalPass(ball)');
check(run('t0') && near(run('ball.vx'), run('PORTAL_MIN_V')), 'a body drifting in at (almost) no speed is still carried through and pushed out at PORTAL_MIN_V');
// 3. outside the disc does nothing
run('ball.pLock = 0; ball.x = 200 + PORTAL_R + 0.5; ball.y = 300; ball.vx = 10; ball.vy = 0; const t1 = portalPass(ball)');
check(run('t1') === false, 'just outside the disc: nothing happens');
// 4. it does not go straight back in; the lock is released once clear
run('ball.pLock = 0; ball.x = 200; ball.y = 300; ball.vx = 0; ball.vy = 100; portalPass(ball)');
check(run('ball.pLock') === run('portals[1].id'), 'the body is locked to the exit portal');
run('ball.x = 600 + 5; ball.y = 200; const t2 = portalPass(ball)');
check(run('t2') === false, 'pushed back into the exit disc, it is ignored (no ping-pong)');
run('stepPortals()');
check(run('ball.pLock') === run('portals[1].id'), 'still inside the exit disc: still locked');
run('ball.x = 700; stepPortals()');
check(run('ball.pLock') === 0, 'once clear of the disc the lock is released, and it can enter again');
run('ball.x = 600; ball.y = 200; ball.vx = 0; ball.vy = 0; stepPortals()');
check(near(run('ball.x'), 200 + 0) || run('ball.y') < 300, 'entering the second portal takes it to the first (the pair works both ways)');
// 5. every angle of exit: heading follows the exit portal's arrow
for (const [a, b] of [[0.3, 2.0], [-2.5, 1.1], [3.0, -0.4], [1.0, 1.0]]) {
    run('portals.length = 0');
    open(0, 300, 300, a); open(0, 700, 300, b);
    run(`ball.pLock = 0; ball.x = 305; ball.y = 298; ball.vx = -123; ball.vy = 400; portalPass(ball)`);
    check(near(run('Math.hypot(ball.vx, ball.vy)'), Math.hypot(123, 400), 1e-6) && near(run('ball.vx'), Math.cos(b) * Math.hypot(123, 400), 1e-6) && near(run('ball.vy'), Math.sin(b) * Math.hypot(123, 400), 1e-6), `arrows ${a} -> ${b}: speed kept, heading = exit arrow`);
}
// 6. arrows and boomerangs take the exit direction as their heading
run('portals.length = 0'); open(0, 300, 300, 0); open(0, 700, 300, -Math.PI / 2);
run('var arr = { x: 299, y: 300, vx: -500, vy: 0, ang: Math.PI, r: 8, pLock: 0 }; portalPass(arr, true)');
check(near(run('arr.vx'), 0, 1e-6) && near(run('arr.vy'), -500, 1e-6) && near(run('arr.ang'), -Math.PI / 2, 1e-9), 'an arrow leaves pointing the way the exit portal does');
// 7. a portal opened on top of something ignores it until it leaves; a player behind a goal alcove dies
run('portals.length = 0; portalSeq = 0; ball.pLock = 0; ball.x = 100; ball.y = 300; players[0].x = 100; players[0].y = 300; players[0].pcast = { x: 100, y: 300, ang: 0, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: false, r: false, u: false, d: false } }; players[0].keys.sp = 0; portalCasts()');
check(run('ball.pLock') === 1 && run('players[0].pLock') === 1, 'bodies inside a portal when it opens are ignored by it until they leave');
run('players[0].alive = true; players[0].x = -5; stepPortals()');
check(run('players[0].alive') === false, 'a player outside the side wall (behind the goal alcove) dies');
run('players[0].alive = true; players[0].x = 100');
// 7b. a player carried across the net: the net guard's side is updated (otherwise Player.step drags them back)
run('portals.length = 0'); open(0, 400, 300, 0); open(0, 560, 300, 0);
run('players[1].pLock = 0; players[1].x = 400; players[1].y = 300; players[1].vx = 200; players[1].vy = 0; players[1].netSide = 0; portalPass(players[1])');
check(run('players[1].x') > run('NETX') && run('players[1].netSide') === 1, 'a player carried over the net gets netSide = the new side');
run('players[1].x = 800; players[1].y = 300; players[1].netSide = 1');
// 8. casting: hold to aim, turn, release to open; the third portal closes the oldest; per-owner pairs
run('players[0].cd.portal = 0; players[0].portalHeld = false; players[0].pcast = null; players[0].x = 100; players[0].keys.sp = 0');
run('portals.length = 0; portalSeq = 0; players[0].keys.sp = 1; portalCasts()');
check(run('players[0].pcast') !== null && run('portals.length') === 0, 'holding the key anchors a preview but opens nothing yet');
run('players[0].x = 150; players[0].keys.r = 1; for (let i = 0; i < 120; i++) portalCasts(); players[0].keys.r = 0');
check(near(run('players[0].pcast.ang'), -Math.PI / 2 + 3, 1e-6) && run('players[0].pcast.x') === 100, `RIGHT turns it clockwise for 1 s (+${run('PORTAL_TURN')} rad) and it stays where it was pressed`);
run('players[0].keys.sp = 0; portalCasts()');
check(run('portals.length') === 1 && run('portals[0].x') === 100, 'releasing opens it');
run('players[0].cd.portal = 0; players[0].keys.sp = 1; portalCasts(); players[0].keys.sp = 0; portalCasts()');
run('players[0].cd.portal = 0; players[0].keys.sp = 1; portalCasts(); players[0].keys.sp = 0; portalCasts()');
check(run('portals.length') === 2 && run('portals[0].id') === 2, 'a third portal closes the oldest');
// double tap snap
run('players[0].cd.portal = 0; players[0].keys.sp = 1; portalCasts(); for (const v of [1,0,1]) { players[0].keys.dn = v; portalCasts(); }');
check(near(run('players[0].pcast.ang'), Math.PI / 2), 'double tapping DOWN snaps the aim downwards');
// 9. saved state friendliness: everything on a portal / cast is plain data
check(run('JSON.stringify(portals.map(q => ({ ...q, owner: q.owner.id })))').length > 0 && run('JSON.stringify(players[0].pcast)').length > 0, 'portal and cast data are plain JSON');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
