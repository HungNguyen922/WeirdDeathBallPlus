// RENDER - ball speed lines (streaks).
// ---- Speed lines: the ball's recent positions (one per physics step) are drawn as streaks. Because they are the real path, a ball being swung
// around a player leaves streaks that curve along the arc. Faster = longer (more path covered per unit time), brighter, whiter, and more lanes. ----
const TRAIL_N = 48, TRAIL_V0 = 140, TRAIL_V1 = BALL_VMAX * 0.95;
const PLAYER_TRAIL_V0 = 140, PLAYER_TRAIL_V1 = 450; // players are slower than the ball, so their streaks reach full strength at a lower speed // history length (steps, ~0.4 s); speed where lines appear / are at full strength
const trails = new WeakMap(); // ball -> its recent samples; the renderer owns this, the physics objects know nothing about it
const trailOf = b => { let t = trails.get(b); if (!t) trails.set(b, t = []); return t; };
function trailPush(b) { // one sample per physics step, one streak per body (death ball, each decoy, each player)
    const tr = trailOf(b), v0 = b instanceof Player ? PLAYER_TRAIL_V0 : TRAIL_V0, v1 = b instanceof Player ? PLAYER_TRAIL_V1 : TRAIL_V1;
    tr.push({ x: b.x, y: b.y, k: clamp01((Math.hypot(b.vx, b.vy) - v0) / (v1 - v0)) });
    if (tr.length > TRAIL_N)
        tr.shift();
}
function trailMelt() { // streaks shrink away during the pause between rounds
    for (const b of [ball, ...decoys, ...players]) {
        const tr = trailOf(b);
        if (tr.length)
            tr.shift();
    }
}
function trailClear() {
    trailOf(ball).length = 0;
    for (const p of players)
        trailOf(p).length = 0; // players teleport back to their spawns
}
// Streak colors: the death ball is violet; a player's streak uses their team color (glow = the color itself, core cools toward white as speed climbs).
const VIOLET = { glow: [147, 51, 234], from: [168, 85, 247], to: [245, 235, 255] };
const tints = new Map();
function trailTint(b) {
    if (!(b instanceof Player))
        return VIOLET;
    if (!tints.has(b.color)) {
        const rgb = [1, 3, 5].map(i => parseInt(b.color.slice(i, i + 2), 16));
        tints.set(b.color, { glow: rgb, from: rgb, to: rgb.map(v => Math.round(v + (255 - v) * 0.85)) });
    }
    return tints.get(b.color);
}
function drawTrail(b) {
    const tint = trailTint(b);
    const tr = trailOf(b), br = b.r; // tr = the streak's samples, br = the ball's radius
    const n = tr.length;
    if (n < 4)
        return;
    const pts = [];
    for (let i = n - 1; i >= 0; i -= 2) // head -> tail
        pts.push(tr[i]);
    const m = pts.length;
    if (m < 3)
        return;
    for (let j = 0; j < m; j++) { // local direction and normal from the neighbouring samples
        const a = pts[Math.max(0, j - 1)], b = pts[Math.min(m - 1, j + 1)];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        pts[j].nx = -dy / d;
        pts[j].ny = dx / d;
        pts[j].age = j / (m - 1);
    }
    const head = pts[0].k;
    if (head <= 0 && pts[Math.min(m - 1, 4)].k <= 0)
        return;
    const lanes = head > 0.66 ? [0, -0.55, 0.55, -1, 1] : head > 0.33 ? [0, -0.6, 0.6] : [0];
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round';
    for (const off of lanes) {
        for (let j = 0; j < m - 1; j++) {
            const a = pts[j], b = pts[j + 1], k = (a.k + b.k) / 2, fade = Math.pow(1 - a.age, 1.3);
            if (k <= 0)
                continue;
            const oa = off * br * 0.9 * (1 - a.age * 0.6), ob = off * br * 0.9 * (1 - b.age * 0.6); // lanes converge toward the tail
            const x1 = a.x + a.nx * oa, y1 = a.y + a.ny * oa, x2 = b.x + b.nx * ob, y2 = b.y + b.ny * ob;
            const r = tint.from[0] + (tint.to[0] - tint.from[0]) * k, g = tint.from[1] + (tint.to[1] - tint.from[1]) * k, bl = tint.from[2] + (tint.to[2] - tint.from[2]) * k; // base color -> white-hot as speed climbs
            const core = off === 0;
            if (core) { // soft wide glow under the main streak
                cx.strokeStyle = `rgba(${tint.glow},${0.28 * k * fade})`;
                cx.lineWidth = (10 + 14 * k) * (1 - a.age * 0.8);
                cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
            }
            cx.strokeStyle = `rgba(${r | 0},${g | 0},${bl | 0},${(core ? 0.9 : 0.6) * k * fade})`;
            cx.lineWidth = (core ? 3 + 8 * k : 1.2 + 1.8 * k) * (1 - a.age * 0.85);
            cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
        }
    }
    cx.restore();
}
