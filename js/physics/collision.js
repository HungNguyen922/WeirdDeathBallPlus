// PHYSICS - collision: circle-vs-segment terrain contact, circle-vs-circle bodies, rolling friction,
// and the two bouncy things (hatchet pads and plinko pegs).
function nearestOnSeg(sg, x, y) {
    const ex = sg[2] - sg[0], ey = sg[3] - sg[1];
    const t = Math.max(0, Math.min(1, ((x - sg[0]) * ex + (y - sg[1]) * ey) / (ex * ex + ey * ey)));
    return { x: sg[0] + ex * t, y: sg[1] + ey * t };
}
// Rolling contact: friction couples spin and velocity (topspin/backspin). Unit mass, disc inertia.
function roll(c, nx, ny) {
    const tx = ny, ty = -nx, slip = c.vx * tx + c.vy * ty + c.w * c.r;
    const jt = -slip / 3 * 0.25;
    c.vx += jt * tx;
    c.vy += jt * ty;
    c.w += 2 * jt / c.r;
}
// Push a circle out of the slopes (no bounce unless e > 0). Returns true if resting on an up-facing surface.
// vo = speed of the floor frame the circle is in (0 for fixed geometry); c.hit records the real-world speed it struck an up-facing surface at.
function collideTerrain(c, e, vo = 0, list = SEGS, t = 0) {
    let onGround = false;
    for (const sg of list) {
        const p = nearestOnSeg(sg, c.x, c.y), dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy), R = c.r + t;
        if (d >= R || d === 0)
            continue;
        const nx = dx / d, ny = dy / d;
        c.x = p.x + nx * R;
        c.y = p.y + ny * R;
        const vn = c.vx * nx + c.vy * ny;
        if (vn < 0) {
            if (ny < -0.5)
                c.hit = Math.max(c.hit || 0, -(vn + vo * ny));
            c.vx -= (1 + e) * vn * nx;
            c.vy -= (1 + e) * vn * ny;
        }
        if (c.w !== undefined)
            roll(c, nx, ny);
        if (ny < -0.5)
            onGround = true;
    }
    return onGround;
}
// Hatchet: a ball that touches it leaves along the pad's normal (up and out) with PAD_E x its speed (at least PAD_KICK, at most PAD_MAX).
function padBounce(c) {
    for (let i = 0; i < PADS.length; i++) {
        const sg = PADS[i], q = nearestOnSeg(sg, c.x, c.y), dx = c.x - q.x, dy = c.y - q.y, d = Math.hypot(dx, dy);
        if (d >= c.r || d === 0)
            continue;
        const nx = dx / d, ny = dy / d;
        c.x = q.x + nx * c.r;
        c.y = q.y + ny * c.r;
        const vn = c.vx * nx + c.vy * ny;
        if (vn >= 0)
            continue;
        const out = Math.min(PAD_MAX, Math.max(PAD_KICK, -vn * PAD_E)); // every contact bounces: no soft-hit case, so even a ball rolling across it launches
        const dv = out - vn; // how much the bounce changes the ball's velocity along the pad's normal
        c.vx += dv * nx;
        c.vy += dv * ny;
        for (const p of players) // the tether passes part of that change of direction on to a player leashed to this ball
            if (p.alive && p.onBall && p.tball === c && p.rope && Math.hypot(p.rope.x - p.x, p.rope.y - p.y) >= p.len - PAD_TETHER_SLACK) {
                p.vx += dv * nx * PAD_TETHER_K;
                p.vy += dv * ny * PAD_TETHER_K;
            }
        padFlash[i] = 1;
        c.boost = 1;
    }
}
// Circle-circle collision with mass and restitution. Returns impact speed (0 if none).
function collide(a, b, ma, mb, e) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
    if (d >= min || d === 0)
        return 0;
    const nx = dx / d, ny = dy / d, pen = min - d, tm = ma + mb;
    a.x -= nx * pen * mb / tm;
    a.y -= ny * pen * mb / tm;
    b.x += nx * pen * ma / tm;
    b.y += ny * pen * ma / tm;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0)
        return 0;
    const j = -(1 + e) * vn / (1 / ma + 1 / mb);
    a.vx -= j * nx / ma;
    a.vy -= j * ny / ma;
    b.vx += j * nx / mb;
    b.vy += j * ny / mb;
    return -vn;
}
// Crash shot: player p runs into ball b. They collide elastically (see collide()), so the ball leaves along the line between their centers and the speed it picks up
// depends on how hard and how squarely p hit, like a cue ball hitting an object ball. Hits that push the ball past its speed cap raise the cap briefly (like a hatchet
// hit) so big shots are not clipped. Returns the impact speed (0 if they were not closing).
function crashShot(p, b) {
    const vx0 = b.vx, vy0 = b.vy, hit = collide(p, b, PLAYER_M, BALL_M, CRASH_E);
    crashPush(p.crashK, b, vx0, vy0);
    const s = Math.hypot(b.vx, b.vy);
    if (s > BALL_VMAX)
        b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
    return hit;
}
// Awakened crash: scale the speed body b just gained from a collision (it was moving at vx0, vy0 before) by the crasher's k, so the push it gets from them is k times as hard.
// k is 1 for everyone who is not awake (nothing changes). Balls and decoys also get the temporary speed-cap boost, so a big hit is not clipped.
function crashPush(k, b, vx0, vy0) {
    if (k === 1)
        return;
    b.vx = vx0 + (b.vx - vx0) * k;
    b.vy = vy0 + (b.vy - vy0) * k;
    if (b.boost !== undefined) {
        const s = Math.hypot(b.vx, b.vy);
        if (s > BALL_VMAX)
            b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
    }
}
// Plinko peg: same bounce as the hatchet. Every contact launches the thing off the peg along the contact normal with PAD_E x its
// speed (at least PAD_KICK, at most PAD_MAX); the ball also gets the hatchet's temporary speed-cap boost. There is no soft-hit case.
function pegBounce(c, q) {
    const dx = c.x - q.x, dy = c.y - q.y, d = Math.hypot(dx, dy);
    if (d >= c.r + q.r || d === 0)
        return false;
    const nx = dx / d, ny = dy / d;
    c.x = q.x + nx * (c.r + q.r);
    c.y = q.y + ny * (c.r + q.r);
    const vn = c.vx * nx + c.vy * ny;
    if (vn >= 0)
        return false;
    const out = Math.min(PAD_MAX, Math.max(PAD_KICK, -vn * PAD_E)); // every contact bounces: no soft-hit threshold, glancing or slow touches launch too
    c.vx += (out - vn) * nx;
    c.vy += (out - vn) * ny;
    q.flash = 1;
    q.nx = nx; q.ny = ny; q.hits = (q.hits | 0) + 1; // for the renderer: which way the hit came from (peg -> thing that hit it), and a counter so each hit's sparks look different
    if (c.boost !== undefined)
        c.boost = 1;
    return true;
}
