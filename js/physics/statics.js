// PHYSICS - statics: things a special PLACES and leaves where they are (the ACCELERATOR special's nodes today). Never draws.
// Mirrors projectiles.js: one list, `statics`, and a table of types, STATIC_TYPES, each registered by the special's own file (see physics/accelerator.js).
// Load order: after constants.js and bodies.js, before game/rules.js (which calls stepStatics() and clearStatics()).
//
// A static is plain data: { type, id, x, y, owner, team, life, flash, ...whatever its type adds }. owner is saved as the player's id (see game/simstate.js), so saveState / rollback /
// prediction carry statics with no extra work.
//
// Hooks a type may define (all optional):
//   max            most one owner can have of this type: placing another removes that owner's oldest
//   life           seconds a placed one lasts. 0 = until the round ends or it is replaced. Never Infinity: snapshots are JSON and would turn it into null
//   fx             seconds its flash takes to fade (display only, default 0.3)
//   step(s, bodies) once per tick, after everything has moved. bodies = what a static may affect right now (see staticBodies)
//
// Not here (yet): plinko pegs, portals and mines could move in later (each has more consumers than a plain placed object: pegs bounce things in Ball / Player / arrows, portals are
// linked pairs, mines sit on the moving floor). Smoke does not fit at all: it is a timer on the player, not a placed object.
const statics = [];
const STATIC_TYPES = {}; // each special registers its own type
let staticSeq = 0; // last id handed out (saved, so a rollback hands out the same ids). Ids only grow, so "older" always means "smaller id"
const staticsOf = type => statics.filter(s => s.type === type);

function placeStatic(type, owner, x, y, extra = {}) { // extra overrides anything and adds per-type fields
    const T = STATIC_TYPES[type];
    const s = { type, id: ++staticSeq, x, y, owner, team: owner.team, life: T.life || 0, flash: 1, ...extra };
    statics.push(s);
    if (T.max) {
        const mine = statics.filter(q => q.type === type && q.owner === owner); // oldest first: that is the order they were pushed in
        while (mine.length > T.max)
            removeStatic(mine.shift());
    }
    return s;
}
function removeStatic(s) {
    const i = statics.indexOf(s);
    if (i >= 0)
        statics.splice(i, 1);
}
function clearStatics() { // new round
    statics.length = 0;
}

// Does the segment a -> b cross the segment p -> q? (a is where something was, b where it is now.) Half-open on a -> b, so a crossing exactly at a tick boundary counts once, not twice.
function segCross(ax, ay, bx, by, px, py, qx, qy) {
    const d1x = bx - ax, d1y = by - ay, d2x = qx - px, d2y = qy - py, den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9)
        return false; // parallel (or not moving)
    const t = ((px - ax) * d2y - (py - ay) * d2x) / den, u = ((px - ax) * d1y - (py - ay) * d1x) / den;
    return t >= 0 && t < 1 && u >= 0 && u <= 1;
}

// Everything a static may affect: the death ball, living players, decoys and projectiles that are in flight.
function staticBodies() {
    const out = [ball];
    for (const p of players)
        if (p.alive)
            out.push(p);
    for (const d of decoys)
        if (!d.dead)
            out.push(d);
    for (const q of projectiles)
        if (!q.stuck)
            out.push(q);
    return out;
}

function stepStatics() { // once per tick, after the bodies have moved
    if (!statics.length)
        return;
    const bodies = staticBodies();
    for (const s of statics) {
        const T = STATIC_TYPES[s.type];
        s.flash = Math.max(0, (s.flash || 0) - DT / ((T && T.fx) || 0.3));
        if (T && T.step)
            T.step(s, bodies);
    }
    for (let i = statics.length - 1; i >= 0; i--) {
        const s = statics[i], T = STATIC_TYPES[s.type];
        if (!T || (T.life && (s.life -= DT) <= 0))
            statics.splice(i, 1);
    }
}
