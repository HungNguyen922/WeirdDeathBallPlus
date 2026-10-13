// PHYSICS - portals: the PORTAL special. Never draws (see drawPortals in render/entities.js).
// Load order: after boomerangs.js (it reads players, ball, decoys, arrows, boomerangs and wrapAng) and before game/rules.js (which calls stepPortals()).
// Tuning numbers live in constants.js (PORTAL_*).
//
// HOW IT PLAYS: hold the special key and a portal is anchored where you stand. While you hold, LEFT / RIGHT turn it (double tap an arrow key to snap it that way, same as ARROW); release
// to open it. Open two and they are linked: ANYTHING whose centre is inside one disc is carried to the other and comes out heading the way THAT portal points, with its speed kept.
// A third portal replaces your oldest. Everyone can use everyone's.
//
// A portal has no front and back: you can enter from any angle, anywhere in the disc. The arrow only says which way things come OUT of it. They appear just outside the disc (so they are
// clear of it and never sit inside a portal waiting), at that heading, at the speed they came in with (never below PORTAL_MIN_V, so something that drifts in still gets out).
// Bodies that move in sub-steps (arrows, boomerangs) call portalPass() themselves after each sub-step, and their heading turns to the exit direction. Players, the death ball and decoys
// are checked once per tick by stepPortals(). A portal just moves the body, so it can carry it across the net; for a player it also refreshes netSide (as Warp does), because Player.step's net guard would otherwise put them back.
// A body that was inside a portal when it opened, or came out of one and was pushed back into the disc (an exit pointing into the floor), is ignored by that portal until it has left the
// disc (b.pLock), so nothing ping-pongs.
// A player who ends up outside the side walls (behind a goal alcove, in the out-of-bounds tunnel) dies.
const portals = []; // { id, x, y, ang, owner, team, flash }  oldest first. Pairs are the portals with the same owner. ang is a screen angle (0 = right, -PI/2 = up)
let portalSeq = 0; // last portal id handed out (saved, so a rollback hands out the same ids)
function partnerOf(q) {
    for (const o of portals)
        if (o !== q && o.owner === q.owner)
            return o;
    return null;
}
function clearPortals() { // new round
    portals.length = 0;
    for (const p of allPlayers) {
        p.pcast = null;
        p.portalHeld = false;
        p.pLock = 0;
    }
    ball.pLock = 0;
}
// If body b (already moved to its new x, y) has its centre inside a portal's disc, carry it through. Returns true if it went through.
// turnAng = also set b.ang (arrows and boomerangs keep their heading in it).
function portalPass(b, turnAng = false) {
    if (portals.length < 2)
        return false;
    for (const A of portals) {
        if (b.pLock === A.id || Math.hypot(b.x - A.x, b.y - A.y) >= PORTAL_R)
            continue;
        const B = partnerOf(A);
        if (!B)
            continue;
        const ex = Math.cos(B.ang), ey = Math.sin(B.ang), sp = Math.max(Math.hypot(b.vx, b.vy), PORTAL_MIN_V), gap = PORTAL_R + (b.r || 0) + PORTAL_EXIT_GAP;
        b.x = B.x + ex * gap; // just outside the exit disc, on the side it points
        b.y = B.y + ey * gap;
        b.vx = ex * sp;
        b.vy = ey * sp;
        if (turnAng && b.ang !== undefined)
            b.ang = B.ang;
        if (b instanceof Player)
            b.netSide = b.x < NETX ? 0 : 1; // like Warp: tell the net guard in Player.step which side we are on now, or it drags us back across the net
        b.pLock = B.id; // (cleared as soon as it is clear of the disc; only matters if something pushes it straight back in)
        A.flash = B.flash = 1;
        return true;
    }
    return false;
}
function aimingCastRunning(p) { // ARROW / MARIONETTE / BAT read the arrow keys live: none of them can run at the same time as a portal or swap aim
    return p.casts.some(c => AIMING.includes(c.type));
}
function portalAimStep(c, k, turn = PORTAL_TURN, dbl = PORTAL_DBL_T) { // the same aim controls as ARROW: LEFT / RIGHT turn it, a double tap on an arrow key snaps it that way (SWAP uses this too)
    const now = { l: !!k.l, r: !!k.r, u: !!k.up, d: !!k.dn };
    for (const id in now) {
        c.tap[id] = Math.max(0, c.tap[id] - DT);
        if (now[id] && !c.prev[id]) {
            if (c.tap[id] > 0) {
                c.ang = ARROW_SNAP[id];
                c.tap[id] = 0;
                c.noTilt = true;
            } else
                c.tap[id] = dbl;
        }
        c.prev[id] = now[id];
    }
    if (!now.l && !now.r)
        c.noTilt = false;
    if (now.l !== now.r && !c.noTilt)
        c.ang = wrapAng(c.ang + (now.r ? 1 : -1) * turn * DT);
}
function placePortal(p, c) {
    const mine = portals.filter(q => q.owner === p);
    if (mine.length >= PORTAL_MAX)
        portals.splice(portals.indexOf(mine[0]), 1); // the oldest closes
    const q = { id: ++portalSeq, x: c.x, y: c.y, ang: c.ang, owner: p, team: p.team, flash: 1 };
    portals.push(q);
    for (const b of [...players, ball, ...decoys, ...arrows, ...boomerangs]) // whatever is already inside it is ignored until it leaves
        if (b.alive !== false && Math.hypot(b.x - q.x, b.y - q.y) < PORTAL_R + (b.r || 0))
            b.pLock = q.id;
    p.cd.portal = PORTAL_COOLDOWN; // (player.js ticks every entry of p.cd down, and reset() fills it from the ABILITY table)
}
function portalCasts() {
    for (const p of players) {
        const k = p.keys, held = (p.special === 'portal' && !!k.sp) || (twoSpecials && p.special2 === 'portal' && !!k.sp2);
        if (!p.alive)
            p.pcast = null;
        else if (p.pcast) {
            if (held)
                portalAimStep(p.pcast, k);
            else {
                placePortal(p, p.pcast);
                p.pcast = null;
            }
        } else if (held && !p.portalHeld && !(p.cd.portal > 0) && !p.scast && !aimingCastRunning(p))
            p.pcast = { x: p.x, y: p.y, ang: -Math.PI / 2, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: !!k.l, r: !!k.r, u: !!k.up, d: !!k.dn } }; // starts pointing up, anchored where you pressed
        p.portalHeld = held;
    }
}
function stepPortals() { // once per tick, after the bodies have moved
    for (const q of portals)
        q.flash = Math.max(0, (q.flash || 0) - DT / PORTAL_FX);
    const once = [...players.filter(p => p.alive), ball, ...decoys]; // everything that moves in one step per tick
    for (const b of once)
        portalPass(b);
    portalCasts();
    for (const b of [...once, ...arrows, ...boomerangs]) {
        if (b.pLock) {
            const q = portals.find(o => o.id === b.pLock);
            if (!q || Math.hypot(b.x - q.x, b.y - q.y) > PORTAL_R + (b.r || 0) + 2)
                b.pLock = 0; // it has left the disc (or the portal is gone)
        }
    }
    for (const p of players)
        if (p.alive && (p.x < 0 || p.x > W)) { // behind a goal alcove: out of the arena
            p.alive = false;
            p.rope = null;
            p.pending = null;
            p.onBall = false;
            p.tball = null;
        }
}
