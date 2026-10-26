// Headless tests for the Swap special. Run:  node js/test/swap-test.js
// Needs only constants.js, portals.js and swap.js (it stubs the bodies), so it runs even without the rest of the sim.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
const ctx = vm.createContext({ console, Math });
const load = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
load('js/physics/constants.js');
vm.runInContext(`
class Player {}
const mk = (id, x, y) => Object.assign(new Player(), { cd: { swap: 0, portal: 0 }, casts: [], netSide: 0, id, team: id % 2, color: '#fff', x, y, vx: 0, vy: 0, r: 16, alive: true, keys: { l: 0, r: 0, up: 0, dn: 0, z: 0, x: 0, sp: 0, sp2: 0 }, special: 'swap', special2: 'dash' });
const allPlayers = [mk(0, 100, 300), mk(1, 800, 300), mk(2, 0, 0), mk(3, 0, 0)], players = [allPlayers[0], allPlayers[1]];
const ball = { x: 900, y: 50, vx: 7, vy: 8, r: 14 }, decoys = [], projectiles = [], PROJ_TYPES = { arrow: { swappable: true }, boomerang: { swappable: true } }, arrow0 = () => projectiles.find(p => p.type === 'arrow'), boom0 = () => projectiles.find(p => p.type === 'boomerang');
let twoSpecials = false;
const AIMING = ['arrow', 'marionette', 'bat'];
const wrapAng = a => Math.atan2(Math.sin(a), Math.cos(a));
const ARROW_SNAP = { l: Math.PI, r: 0, u: -Math.PI / 2, d: Math.PI / 2 };
`, ctx);
load('js/physics/portals.js');
load('js/physics/swap.js');
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + msg); };
const run = c => vm.runInContext(c, ctx);
const reset = () => run(`
players[0].x = 100; players[0].y = 300; players[0].vx = 11; players[0].vy = 12; players[0].alive = true; players[0].cd.swap = 0; players[0].scast = null; players[0].swapHeld = false; players[0].swapAng = 0; players[0].keys.sp = 0; players[0].keys.x = 0; players[0].pcast = null; players[0].casts = [];
players[1].x = 700; players[1].y = 600; players[1].alive = true;
ball.x = 700; ball.y = 20; decoys.length = 0; projectiles.length = 0;`);

// 1. what is in the cone (aim = 0, i.e. pointing right; the cone reaches 15 PL = 480 u)
reset();
run('decoys.push({ x: 250, y: 310, r: 14, vx: 0, vy: 0 }); projectiles.push({ type: "arrow", x: 400, y: 290, r: 8, vx: 0, vy: 0, stuck: false }); projectiles.push({ type: "boomerang", x: 560, y: 300, r: 10, vx: 0, vy: 0 })');
check(run('swapPick(players[0], 0, false) === decoys[0]'), 'nearest in the cone is picked');
check(run('swapPick(players[0], 0, true) === boom0()'), 'furthest in the cone is picked when far = true');
run('arrow0().stuck = true');
check(run('swapPick(players[0], 0, false) === decoys[0] && swapPick(players[0], 0, true) === boom0()'), 'a stuck arrow does not change who is nearest / furthest here');
run('decoys[0].dead = true');
check(run('swapPick(players[0], 0, false) === arrow0()'), 'a dead decoy is not a target, and an arrow stuck in the terrain is');
run('for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].type === "arrow") projectiles.splice(i, 1)');
run('boom0().x = 100 + SWAP_RANGE + 40');
check(run('swapPick(players[0], 0, true) === null'), 'beyond the cone\'s range nothing is picked (and the player never picks themselves)');
run('boom0().x = 300; boom0().y = 300 + 300 * Math.tan(SWAP_HALF + 0.2)');
check(run('swapPick(players[0], 0, false) === null'), 'outside the cone\'s angle nothing is picked');
check(run('swapPick(players[0], Math.atan2(boom0().y - 300, 200), false) === boom0()'), 'turning the aim onto it picks it');
run('players[1].x = 100; players[1].y = 200');
check(run('swapPick(players[0], -Math.PI / 2, false) === players[1]'), 'other players (including teammates) are targets');
check(run('swapPick(players[0], Math.PI, false) === null'), 'aiming at the wall behind picks nothing');
run('players[1].x = 100 - 200; players[1].y = 300 - 1');
check(run('swapPick(players[0], Math.PI + 0.01, false) === players[1] && swapPick(players[0], -Math.PI + 0.01, false) === players[1]'), 'the angle test wraps around +-PI');

// 2. a swap: positions exchanged, velocities kept, net side updated for players
reset();
run('players[1].x = 300; players[1].y = 320; players[1].vx = -5; players[1].vy = 6; players[1].netSide = 0; players[0].netSide = 0');
run('doSwap(players[0], players[1])');
check(run('players[0].x === 300 && players[0].y === 320 && players[1].x === 100 && players[1].y === 300'), 'places are exchanged');
check(run('players[0].vx === 11 && players[0].vy === 12 && players[1].vx === -5 && players[1].vy === 6'), 'everyone keeps their own velocity');
reset();
run('players[0].x = 400; players[0].netSide = 0; players[1].x = 560; players[1].y = 300; players[1].netSide = 1; doSwap(players[0], players[1])');
check(run('players[0].netSide === 1 && players[1].netSide === 0'), 'swapping across the net updates both players\' net side (the net guard would drag them back otherwise)');
reset();
run('ball.x = 400; ball.y = 300; ball.vx = 3; doSwap(players[0], ball)');
check(run('ball.x === 100 && ball.y === 300 && players[0].x === 400 && ball.vx === 3'), 'swapping with the ball moves both and keeps the ball\'s velocity');

// 2b. a landed arrow comes loose and falls; the flight data for the animation is recorded
reset();
run('projectiles.push({ type: "arrow", x: 300, y: 320, r: 8, vx: 0, vy: 0, ang: 0.5, team: 1, stuck: true, life: 1, immune: 0, ghost: 0 }); doSwap(players[0], arrow0())');
check(run('arrow0().stuck === false && arrow0().x === 100 && arrow0().y === 300 && players[0].x === 300 && players[0].y === 320'), 'swapping with a stuck arrow trades places and frees the arrow');
check(run('arrow0().ghost === ARROW_GHOST_T && arrow0().life >= ARROW_KNOCK_LIFE'), 'the freed arrow ignores terrain for a moment and lives long enough to land');
check(run('players[0].swapFx.bk') === 'arrow' && run('players[0].swapFx.bcol') === '#ef5350' && run('players[0].swapFx.pr') === 16, 'the swap records what was swapped, for the animation');
reset();
run('doSwap(players[0], ball)');
check(run('players[0].swapFx.bk') === 'ball' && run('players[0].swapFx.bid') === -1, 'a ball is recorded as a ball (no player id)');
run('players[1].x = 300; players[1].y = 300; doSwap(players[0], players[1])');
check(run('players[0].swapFx.bk') === 'player' && run('players[0].swapFx.bid') === 1, 'a player is recorded with its id, so it can fade in at its new spot');

// 3. the whole cast: hold, turn, release
reset();
run('decoys.push({ x: 250, y: 300, r: 14, vx: 0, vy: 0 }); projectiles.push({ type: "boomerang", x: 500, y: 300, r: 10, vx: 0, vy: 0 }); players[0].keys.sp = 1; stepSwaps()');
check(run('players[0].scast') !== null && run('players[0].scast.ang') === 0, 'holding the key opens the cone, starting where the last one pointed');
run('players[0].keys.sp = 0; stepSwaps()');
check(run('players[0].x') === 250 && run('decoys[0].x') === 100 && run('players[0].cd.swap') === run('SWAP_COOLDOWN'), 'releasing swaps with the nearest in the cone and starts the cooldown');
reset();
run('decoys.push({ x: 250, y: 300, r: 14, vx: 0, vy: 0 }); projectiles.push({ type: "boomerang", x: 500, y: 300, r: 10, vx: 0, vy: 0 }); players[0].keys.sp = 1; stepSwaps(); players[0].keys.x = 1; players[0].keys.sp = 0; stepSwaps()');
check(run('players[0].x') === 500 && run('boom0().x') === 100, 'releasing while holding weight swaps with the furthest');
reset();
run('players[0].keys.sp = 1; stepSwaps(); players[0].keys.sp = 0; stepSwaps()');
check(run('players[0].x') === 100 && run('players[0].cd.swap') === run('SWAP_MISS_CD') && run('players[0].scast') === null, 'nothing in the cone: nothing happens, only the short miss cooldown');
// aim controls
reset();
run('players[0].swapAng = 0; players[0].keys.sp = 1; stepSwaps(); players[0].keys.r = 1; for (let i = 0; i < 120; i++) stepSwaps(); players[0].keys.r = 0');
check(Math.abs(run('players[0].scast.ang') - run('SWAP_TURN')) < 1e-6, 'RIGHT turns the cone clockwise at SWAP_TURN rad/s');
run('for (const v of [1, 0, 1]) { players[0].keys.dn = v; stepSwaps(); }');
check(Math.abs(run('players[0].scast.ang') - Math.PI / 2) < 1e-9, 'double tapping DOWN snaps it downwards');
run('players[0].keys.sp = 0; stepSwaps()');
check(Math.abs(run('players[0].swapAng') - Math.PI / 2) < 1e-9, 'the next cone starts where this one ended');
// 4. rules about when a cast can start
reset();
run('players[0].cd.swap = 1; players[0].keys.sp = 1; stepSwaps()');
check(run('players[0].scast') === null, 'no cone during the cooldown');
reset();
run('players[0].pcast = {}; players[0].keys.sp = 1; stepSwaps()');
check(run('players[0].scast') === null, 'no cone while aiming a portal');
reset();
run('players[0].casts = [{ type: "arrow" }]; players[0].keys.sp = 1; stepSwaps()');
check(run('players[0].scast') === null, 'no cone while another aiming cast (arrow / marionette / bat) is running');
reset();
run('players[0].keys.sp = 1; stepSwaps(); players[0].alive = false; stepSwaps()');
check(run('players[0].scast') === null, 'dying cancels the cone');
reset();
run('twoSpecials = true; players[0].special = "dash"; players[0].special2 = "swap"; players[0].keys.sp2 = 1; stepSwaps()');
check(run('players[0].scast') !== null, 'works from the second special key too');
run('twoSpecials = false');
check(run('JSON.stringify(players[0].scast)').length > 0 && run('JSON.stringify(players[0].swapFx)') !== undefined, 'cast and flash data are plain JSON');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
