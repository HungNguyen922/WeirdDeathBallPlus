// RENDER - impact effects: an impact frame (white-hot flash and radial lines for a few frames), a shockwave ring, a streak along the launch direction and a spray of sparks
// in the team color. Used for bat hits (events.onBatHit) and for a player slamming into terrain, pegs, other players and balls (events.onImpact). Everything is sized by how hard
// the hit was. Read-only on game state: the physics only calls the events (see rules.js), and everything here lives in this file.
const impacts = []; // { x, y, ux, uy, k, r, tint, a (age, s), sparks: [{ x, y, vx, vy, life, w, mix }] }
let impSeed = 12345, impLast = 0;
const impRand = () => { impSeed = (impSeed * 1664525 + 1013904223) >>> 0; return impSeed / 4294967296; }; // small seeded generator: the effects never touch Math.random
const IMP_FRAME_T = 0.09, IMP_RING_T = 0.32, IMP_STREAK_T = 0.18, IMP_MAX = 12; // length (s) of the impact frame, shockwave and launch streak; most impacts alive at once
function impactsClear() { impacts.length = 0; }
function spawnImpactFx(p, r, x, y, ux, uy, k, spread) { // p = whose team color, r = size of what was hit, (ux, uy) = where sparks fly, k = 0..1 how hard, spread = cone half-angle (rad)
    const sparks = [], n = Math.round(8 + 32 * k), base = Math.atan2(uy, ux);
    for (let i = 0; i < n; i++) {
        const cone = i % 4 === 3 ? Math.PI : spread; // most sparks fly along the direction, a quarter spray out sideways / back
        const ang = base + (impRand() - 0.5) * 2 * cone, sp = (140 + impRand() * 520) * (0.6 + 0.6 * k);
        sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.22 + impRand() * 0.38, w: 1.2 + impRand() * 1.8, mix: impRand() });
    }
    impacts.push({ x, y, ux, uy, k, r, tint: trailTint(p), a: 0, sparks });
    if (impacts.length > IMP_MAX)
        impacts.shift();
}
function spawnBatImpact(p, b, x, y, ux, uy, k) { spawnImpactFx(p, b.r, x, y, ux, uy, k, 0.8); } // k = 0..1: how hard the bat hit
const impHit = new WeakMap(); // player -> time of their last impact effect, so a body scraping along a wall does not spam them
function spawnImpact(p, x, y, ux, uy, v) { // a player hit something at speed v: from a small puff just over IMPACT_V0 up to a full burst at IMPACT_V1
    const now = performance.now();
    if (now - (impHit.get(p) || 0) < 70)
        return;
    impHit.set(p, now);
    spawnImpactFx(p, p.r * 0.5, x, y, ux, uy, 0.12 + 0.88 * clamp01((v - IMPACT_V0) / (IMPACT_V1 - IMPACT_V0)), 1.1);
}
function drawImpacts() {
    const now = performance.now(), dt = Math.min(0.05, impLast ? (now - impLast) / 1000 : 0);
    impLast = now;
    if (!impacts.length)
        return;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round';
    for (let n = impacts.length - 1; n >= 0; n--) {
        const m = impacts[n], t = m.tint, sc = 0.45 + 0.55 * m.k, ga = 0.55 + 0.45 * m.k; // sc / ga: everything's size / brightness follows how hard the hit was
        m.a += dt;
        const rgb = u => `${(t.from[0] + (t.to[0] - t.from[0]) * u) | 0},${(t.from[1] + (t.to[1] - t.from[1]) * u) | 0},${(t.from[2] + (t.to[2] - t.from[2]) * u) | 0}`; // team color -> white-hot
        if (m.a < IMP_FRAME_T) { // the impact frame: a blown-out flash with radial lines, white-hot at the very start
            const u = m.a / IMP_FRAME_T, hot = 1 - u;
            cx.fillStyle = `rgba(${rgb(0.6 + 0.4 * hot)},${0.9 * Math.pow(hot, 0.6) * ga})`;
            cx.beginPath(); cx.arc(m.x, m.y, (m.r * 1.2 + (14 + 26 * m.k) * (0.4 + u)) * sc, 0, 7); cx.fill();
            const rays = 12, len = (22 + 70 * m.k) * (0.35 + u) * sc;
            cx.strokeStyle = `rgba(${rgb(0.85)},${hot * ga})`; cx.lineWidth = (1.5 + 2.5 * hot) * sc;
            cx.beginPath();
            for (let i = 0; i < rays; i++) {
                const ang = (i / rays) * Math.PI * 2 + 0.3, r0 = m.r * 0.7 + 6 * u;
                cx.moveTo(m.x + Math.cos(ang) * r0, m.y + Math.sin(ang) * r0);
                cx.lineTo(m.x + Math.cos(ang) * (r0 + len * (i % 2 ? 0.6 : 1)), m.y + Math.sin(ang) * (r0 + len * (i % 2 ? 0.6 : 1)));
            }
            cx.stroke();
        }
        if (m.a < IMP_RING_T) { // shockwave ring in the team color
            const u = m.a / IMP_RING_T;
            cx.strokeStyle = `rgba(${rgb(0.3)},${0.8 * (1 - u) * ga})`; cx.lineWidth = (1 + 5 * (1 - u)) * sc;
            cx.beginPath(); cx.arc(m.x, m.y, m.r * 0.8 + u * (60 + 90 * m.k) * sc, 0, 7); cx.stroke();
        }
        if (m.a < IMP_STREAK_T) { // a bright streak shooting off along the launch direction
            const u = m.a / IMP_STREAK_T, L = (50 + 130 * m.k) * (0.3 + 0.7 * Math.sqrt(u)) * sc, x0 = m.x + m.ux * m.r * 0.5 + m.ux * L * 0.15 * u;
            const y0 = m.y + m.uy * m.r * 0.5 + m.uy * L * 0.15 * u;
            cx.strokeStyle = `rgba(${t.glow},${0.35 * (1 - u) * ga})`; cx.lineWidth = (12 * (1 - u) + 2) * sc;
            cx.beginPath(); line(x0, y0, x0 + m.ux * L, y0 + m.uy * L); cx.stroke();
            cx.strokeStyle = `rgba(${rgb(0.9)},${0.9 * (1 - u) * ga})`; cx.lineWidth = (3.5 * (1 - u) + 0.8) * sc;
            cx.beginPath(); line(x0, y0, x0 + m.ux * L, y0 + m.uy * L); cx.stroke();
        }
        let alive = m.a < Math.max(IMP_RING_T, IMP_STREAK_T);
        for (const s of m.sparks) { // sparks: short streaks that fly out, drop a little, slow down and fade
            if (m.a >= s.life)
                continue;
            alive = true;
            s.x += s.vx * dt; s.y += s.vy * dt;
            s.vy += 520 * dt;
            const drag = Math.max(0, 1 - 3 * dt);
            s.vx *= drag; s.vy *= drag;
            const u = m.a / s.life, a = Math.pow(1 - u, 1.2), tx = s.x - s.vx * 0.03, ty = s.y - s.vy * 0.03;
            cx.strokeStyle = `rgba(${t.glow},${0.3 * a})`; cx.lineWidth = s.w * 3.2 * (1 - u * 0.6);
            cx.beginPath(); line(tx, ty, s.x, s.y); cx.stroke();
            cx.strokeStyle = `rgba(${rgb(s.mix * (1 - u * 0.5) * 0.4 + (1 - u) * 0.6)},${a})`; cx.lineWidth = s.w * (1 - u * 0.7);
            cx.beginPath(); line(tx, ty, s.x, s.y); cx.stroke();
        }
        if (!alive)
            impacts.splice(n, 1);
    }
    cx.restore();
}