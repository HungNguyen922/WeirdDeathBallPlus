// PHYSICS - boomerangs: the BOOMERANG special's projectiles. Never draws.
// Load order: after arrows.js (it reuses wrapAng and the arrow terrain lists) and before game/rules.js (which calls stepBoomerangs()).
// Tuning numbers live in constants.js (BOOMERANG_*).
//
// One press throws a VOLLEY of BOOMERANG_VOLLEY boomerangs in a fan along the arrows held (none held: toward the net). Each one flies OUT along a curved, constant-speed arc until it has covered
// its range (the volley's ranges are staggered, so the wave is layered), then comes BACK: it keeps circling the same way it was thrown (so the path is a loop, not a U-turn) and homes in on its
// owner, turning harder the longer it takes, and is caught (removed) when it reaches them.
//
// DEFAULT: the arc bends UP first (over and around). Holding WEIGHT (keys.x) when you throw flips it: the arc bends DOWN first (under and around).
//
// PUSH: going out a boomerang is almost massless (BOOMERANG_M_OUT) so it barely moves what it touches. Coming back it is heavy (BOOMERANG_M_BACK), so whatever it meets on the return leg
// is shoved along with it, toward the owner. The outbound wave sails past an object, the return arc comes round the far side of it and drags it home.
// A boomerang never kills, its own path is not changed by what it hits, and its owner passes straight through it.
const boomerangs = []; // { x, y, vx, vy, ang, sp, team, owner, spin (-1 anticlockwise / +1 clockwise on screen), phase (0 out, 1 back), trav, range, back, life, r, rot }
function clearBoomerangs() { boomerangs.length = 0; }
function boomCount(p) { // how many of p's boomerangs are out right now
    let n = 0;
    for (const b of boomerangs)
        if (b.owner === p)
            n++;
    return n;
}

// Throw a volley from player p along the arrows held (hx, hy are -1 / 0 / 1; both 0 = toward the net).
// inv = flip the arc to bend downward first. Left out, it follows whether p is holding Weight. Returns how many were thrown (0 = already at BOOMERANG_MAX out).
function throwBoomerang(p, hx, hy, inv = !!(p.keys && p.keys.x)) {
    const n = Math.min(BOOMERANG_VOLLEY, BOOMERANG_MAX - boomCount(p));
    if (n <= 0)
        return 0;
    const base = hx || hy ? Math.atan2(hy, hx) : (p.x < NETX ? 0 : Math.PI);
    const spin = (Math.cos(base) >= 0 ? -1 : 1) * (inv ? -1 : 1); // thrown right it curves up first (anticlockwise on screen), thrown left the mirror image; inv flips it
    for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : k / (n - 1) - 0.5; // -0.5 .. 0.5 across the volley
        const ang = wrapAng(base + t * BOOMERANG_FAN), ux = Math.cos(ang), uy = Math.sin(ang);
        const d = p.r + BOOMERANG_R + 2;
        const b = { x: p.x + ux * d, y: p.y + uy * d, vx: ux * BOOMERANG_V, vy: uy * BOOMERANG_V, ang, sp: BOOMERANG_V, team: p.team, owner: p, spin, phase: 0, trav: 0,
            range: BOOMERANG_RANGE * (1 + t * BOOMERANG_RANGE_SPREAD), back: 0, life: BOOMERANG_LIFE, r: BOOMERANG_R, rot: 0 };
        if (boomBlocked(b.x, b.y, b.r)) { // thrown straight into a wall, floor or jut: it starts on you, hits the surface on its first step and comes straight back
            b.x = p.x;
            b.y = p.y;
        }
        boomerangs.push(b);
    }
    return n;
}

// Is a circle at (x, y) with radius r touching the terrain (or outside the arena walls)? The same solids arrows stick into; the net is ignored, like the death ball does.
function boomBlocked(x, y, r) {
    for (const [list, t] of ARROW_SOLIDS)
        for (const sg of list) {
            const q = nearestOnSeg(sg, x, y);
            if (Math.hypot(x - q.x, y - q.y) < r + t)
                return true;
        }
    return (y + r > H && x > 0 && x < W) || y < r || x < r || x > W - r;
}
// Push a boomerang out of the terrain. Returns true if it touched anything.
function boomTerrain(b) {
    let hit = false;
    for (const [list, t] of ARROW_SOLIDS) {
        const x0 = b.x, y0 = b.y;
        collideTerrain(b, 0, 0, list, t);
        if (b.x !== x0 || b.y !== y0)
            hit = true;
    }
    delete b.hit; // collideTerrain leaves a field behind that nothing needs
    if (b.y + b.r > H && b.x > 0 && b.x < W) { // the flat floor between the ramps
        b.y = H - b.r;
        if (b.vy > 0)
            b.vy = 0;
        hit = true;
    }
    if (b.y < b.r) {
        b.y = b.r;
        if (b.vy < 0)
            b.vy = 0;
        hit = true;
    }
    if (b.x < b.r) {
        b.x = b.r;
        if (b.vx < 0)
            b.vx = 0;
        hit = true;
    }
    if (b.x > W - b.r) {
        b.x = W - b.r;
        if (b.vx > 0)
            b.vx = 0;
        hit = true;
    }
    return hit;
}

// The boomerang meets something: a collision where the boomerang weighs BOOMERANG_M_OUT going out (a nudge) and BOOMERANG_M_BACK coming home (a shove), against the thing's own mass.
// The boomerang itself carries straight on.
function boomHit(b, o, mo) {
    const out = b.phase === 0, vx0 = b.vx, vy0 = b.vy, hit = collide(b, o, out ? BOOMERANG_M_OUT : BOOMERANG_M_BACK, mo, out ? BOOMERANG_E_OUT : BOOMERANG_E_BACK);
    b.vx = vx0;
    b.vy = vy0;
    if (hit > IMPACT_V0 && !out) { // sparks only for the hard return hits
        const dx = o.x - b.x, dy = o.y - b.y, m = Math.hypot(dx, dy) || 1;
        events.onImpact(b.owner, b.x + dx / m * b.r, b.y + dy / m * b.r, dx / m, dy / m, hit); // sparks fly the way the thing was pushed
    }
}
function boomBump(b) {
    for (const p of players)
        if (p.alive && p !== b.owner && (BOOMERANG_SOLID_TEAMMATES || p.team !== b.team))
            boomHit(b, p, PLAYER_M);
    boomHit(b, ball, BALL_M);
    for (const d of decoys)
        boomHit(b, d, BALL_M);
}

function stepBoomerangs() {
    for (let i = boomerangs.length - 1; i >= 0; i--) {
        const b = boomerangs[i], o = b.owner;
        b.life -= DT;
        b.rot += BOOMERANG_SPIN * DT;
        if (b.life <= 0 || !o || !o.alive) {
            boomerangs.splice(i, 1); // timed out, or its owner is gone
            continue;
        }
        if (b.phase === 0) { // out: a constant-speed arc
            b.ang = wrapAng(b.ang + b.spin * BOOMERANG_TURN * DT);
            b.sp = BOOMERANG_V;
            b.trav += b.sp * DT;
            if (b.trav >= (b.range || BOOMERANG_RANGE))
                b.phase = 1;
        } else { // back: keep circling the way it was thrown, closing in on the owner, harder and harder, and speed up
            b.back += DT;
            const dist = Math.hypot(o.x - b.x, o.y - b.y); // the turning circle is never allowed to be bigger than the distance left, so it spirals in instead of orbiting you
            const turn = Math.max(BOOMERANG_BACK_TURN + BOOMERANG_BACK_GROW * b.back, b.sp / Math.max(20, dist * 0.4)) * DT;
            let diff = wrapAng(Math.atan2(o.y - b.y, o.x - b.x) - b.ang);
            if (diff * b.spin < 0 && Math.abs(diff) > BOOMERANG_BACK_COMMIT) // the owner is mostly behind and on the "wrong" side: go round the long way (the loop) instead of a U-turn
                diff -= Math.sign(diff) * Math.PI * 2;
            b.ang = wrapAng(b.ang + Math.max(-turn, Math.min(turn, diff)));
            b.sp = Math.min(BOOMERANG_BACK_V, b.sp + BOOMERANG_BACK_ACC * DT);
        }
        b.vx = Math.cos(b.ang) * b.sp;
        b.vy = Math.sin(b.ang) * b.sp;
        const n = Math.max(1, Math.ceil(b.sp * DT / b.r)); // sub-steps of at most one radius, so it cannot skip through a thin wall or a player
        for (let s = 0; s < n; s++) {
            const px = b.x, py = b.y;
            b.x += b.vx * DT / n;
            b.y += b.vy * DT / n;
            portalPass(b, px, py, true);
            if (boomTerrain(b)) {
                if (b.phase === 0)
                    b.phase = 1; // hit a wall on the way out: that is as far as it goes
                const v = Math.hypot(b.vx, b.vy); // slide along the surface, then the homing takes over
                b.ang = v > 30 ? Math.atan2(b.vy, b.vx) : Math.atan2(o.y - b.y, o.x - b.x);
                b.vx = Math.cos(b.ang) * b.sp;
                b.vy = Math.sin(b.ang) * b.sp;
            }
            boomBump(b);
        }
        if (b.phase === 1 && Math.hypot(o.x - b.x, o.y - b.y) <= o.r + b.r + BOOMERANG_CATCH)
            boomerangs.splice(i, 1); // caught
    }
}
