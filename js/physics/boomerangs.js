// PHYSICS - boomerangs: the BOOMERANG special's projectiles. Never draws.
// Load order: after arrows.js (it reuses wrapAng and the arrow terrain lists) and before game/rules.js (which calls stepBoomerangs()).
// Tuning numbers live in constants.js (BOOMERANG_*).
//
// A boomerang is thrown with one tap (see startAbility in player.js) along the arrows held (none held: toward the net). It flies OUT along a constant-speed arc until it has covered
// BOOMERANG_RANGE, then comes BACK: it homes in on its owner, turning harder the longer it takes, and is caught (removed) when it reaches them. Touching terrain on the way out
// also turns it round. Every boomerang a player has in the air counts against BOOMERANG_MAX, so a catch is what gives the throw back.
// It never kills and never knocks hard: it is a light solid body that takes up space, and whatever it runs into (players, the death ball, decoys) is nudged out of its way.
// Its own path is not changed by what it hits, and its owner passes straight through it.
const boomerangs = []; // { x, y, vx, vy, ang, sp, team, owner, spin, phase (0 out, 1 back), trav, back, life, r, rot }
function clearBoomerangs() { boomerangs.length = 0; }
function boomCount(p) { // how many of p's boomerangs are out right now
    let n = 0;
    for (const b of boomerangs)
        if (b.owner === p)
            n++;
    return n;
}

// Throw one from player p along the arrows held (hx, hy are -1 / 0 / 1; both 0 = toward the net).
function throwBoomerang(p, hx, hy) {
    const ang = hx || hy ? Math.atan2(hy, hx) : (p.x < NETX ? 0 : Math.PI), ux = Math.cos(ang), uy = Math.sin(ang);
    const flip = p.boomFlip === -1 ? -1 : 1; // BOOMERANG_ALTERNATE: every throw curves the other way, so a spammed volley fans out
    if (BOOMERANG_ALTERNATE)
        p.boomFlip = -flip;
    const spin = (ux >= 0 ? -1 : 1) * (BOOMERANG_ALTERNATE ? flip : 1); // thrown right it curves up first (anticlockwise on screen), thrown left the mirror image
    const d = p.r + BOOMERANG_R + 2, b = { x: p.x + ux * d, y: p.y + uy * d, vx: ux * BOOMERANG_V, vy: uy * BOOMERANG_V, ang, sp: BOOMERANG_V, team: p.team, owner: p, spin, phase: 0, trav: 0, back: 0, life: BOOMERANG_LIFE, r: BOOMERANG_R, rot: 0 };
    if (boomBlocked(b.x, b.y, b.r)) { // thrown straight into a wall, floor or jut: it starts on you, hits the surface on its first step and comes straight back
        b.x = p.x;
        b.y = p.y;
    }
    boomerangs.push(b);
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

// The boomerang meets something: a light-body collision (mass BOOMERANG_M against the thing's mass, restitution BOOMERANG_E) shoves the thing out of the way and gives it a small share
// of the boomerang's motion. The boomerang itself carries straight on.
function boomHit(b, o, mo) {
    const vx0 = b.vx, vy0 = b.vy, hit = collide(b, o, BOOMERANG_M, mo, BOOMERANG_E);
    b.vx = vx0;
    b.vy = vy0;
    if (hit > IMPACT_V0) {
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
            if (b.trav >= BOOMERANG_RANGE)
                b.phase = 1;
        } else { // back: turn toward the owner, harder and harder, and speed up
            b.back += DT;
            const dist = Math.hypot(o.x - b.x, o.y - b.y); // the turning circle is never allowed to be bigger than the distance left, so it spirals in instead of orbiting you
            const turn = Math.max(BOOMERANG_BACK_TURN + BOOMERANG_BACK_GROW * b.back, b.sp / Math.max(20, dist * 0.4)) * DT, diff = wrapAng(Math.atan2(o.y - b.y, o.x - b.x) - b.ang);
            b.ang = wrapAng(b.ang + Math.max(-turn, Math.min(turn, diff)));
            b.sp = Math.min(BOOMERANG_BACK_V, b.sp + BOOMERANG_BACK_ACC * DT);
        }
        b.vx = Math.cos(b.ang) * b.sp;
        b.vy = Math.sin(b.ang) * b.sp;
        const n = Math.max(1, Math.ceil(b.sp * DT / b.r)); // sub-steps of at most one radius, so it cannot skip through a thin wall or a player
        for (let s = 0; s < n; s++) {
            b.x += b.vx * DT / n;
            b.y += b.vy * DT / n;
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
