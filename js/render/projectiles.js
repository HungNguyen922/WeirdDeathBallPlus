// RENDER - projectiles: the circular timer used by pegs and casts, plinko pegs, arrows (with their streaks) and boomerangs. Read-only on game state.
// RENDER - everything that moves: pegs, abilities in progress, ropes, players, balls, banner. Read-only on game state.
function drawTimer(x, y, rad, frac, col) { // circular timer: faint full track plus an arc of the remaining fraction, starting at 12 o'clock
    cx.lineWidth = 2.5;
    cx.strokeStyle = 'rgba(255,255,255,.18)';
    cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.stroke();
    cx.strokeStyle = col;
    cx.beginPath(); cx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac); cx.stroke();
}
function drawPegs() { // plinko pegs: a spark burst and a pop-in when deployed, a squash / glow / spray of sparks when hit
    const fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453), easeOut = u => 1 - (1 - u) * (1 - u);
    const DEPLOY_T = 0.45; // seconds the deploy effect lasts
    for (const q of pegs) {
        const col = q.team === 0 ? '#42a5f5' : '#ef5350', flicker = q.life < 2 ? 0.45 + 0.4 * Math.sin(q.life * 24) : 1; // flickers while fizzling out
        const age = PEG_LIFE - q.life, du = clamp01(age / DEPLOY_T), deploying = du < 1;
        const hit = (q.hits | 0) > 0 && q.nx !== undefined && q.flash > 0, hu = 1 - q.flash; // hu: 0 right at the hit, 1 when it has faded
        const grow = deploying ? 1 + 2.7 * Math.pow(du - 1, 3) + 1.7 * Math.pow(du - 1, 2) : 1; // pops in from nothing with a little overshoot
        const squash = hit ? 1 + 0.45 * q.flash * q.flash : 1; // swells when hit, then settles
        const rr = (q.r - 1) * grow * squash;
        cx.save();
        cx.globalAlpha = flicker;
        if (hit) { cx.shadowColor = col; cx.shadowBlur = 6 + 22 * q.flash; }
        cx.fillStyle = '#e8e8e4'; cx.strokeStyle = col; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(q.x, q.y, Math.max(0.5, rr), 0, 7); cx.fill(); cx.stroke();
        cx.shadowBlur = 0;
        if (hit) { // the peg lights up in its team colour and fades back
            cx.globalAlpha = flicker * q.flash * 0.85; cx.fillStyle = col;
            cx.beginPath(); cx.arc(q.x, q.y, Math.max(0.5, rr - 1), 0, 7); cx.fill();
        }
        cx.globalAlpha = flicker;
        drawTimer(q.x, q.y, q.r + 5, Math.max(0, q.life) / PEG_LIFE, col);
        cx.restore();

        cx.save();
        cx.globalCompositeOperation = 'lighter';
        cx.lineCap = 'round';
        if (deploying) { // deploy: a ring, a twinkling cross and a ring of sparks flying out of the spot
            const e = easeOut(du), a = 1 - du;
            cx.strokeStyle = col; cx.globalAlpha = 0.9 * a * flicker; cx.lineWidth = 1 + 3 * a;
            cx.beginPath(); cx.arc(q.x, q.y, q.r + 4 + 24 * e, 0, 7); cx.stroke();
            const star = (1 - du) * (q.r + 16); // a 4-point twinkle that shrinks away
            cx.strokeStyle = '#fff'; cx.globalAlpha = 0.95 * a * flicker; cx.lineWidth = 1.5 + 2 * a;
            cx.beginPath();
            line(q.x - star, q.y, q.x + star, q.y);
            line(q.x, q.y - star, q.x, q.y + star);
            cx.stroke();
            for (let i = 0; i < 12; i++) {
                const h = hash(i), h2 = hash(i + 0.5), ang = (i / 12) * Math.PI * 2 + (h - 0.5) * 0.4, ux = Math.cos(ang), uy = Math.sin(ang);
                const reach = 14 + 26 * h2, head = q.r + reach * e, tail = q.r + reach * easeOut(Math.max(0, du - 0.35));
                cx.strokeStyle = i % 2 ? col : '#fff'; cx.globalAlpha = 0.95 * a * flicker; cx.lineWidth = 1 + 2 * h2 * a;
                cx.beginPath(); line(q.x + ux * tail, q.y + uy * tail, q.x + ux * head, q.y + uy * head); cx.stroke();
            }
        }
        if (hit) { // hit: a shock ring and a spray of sparks, mostly toward the side that was hit (where the thing came from)
            const e = easeOut(hu), a = 1 - hu, base = Math.atan2(q.ny, q.nx), seed = (q.hits || 0) * 7;
            cx.strokeStyle = '#fff'; cx.globalAlpha = 0.8 * a * flicker; cx.lineWidth = 1 + 3 * a;
            cx.beginPath(); cx.arc(q.x, q.y, q.r + 3 + 28 * e, 0, 7); cx.stroke();
            for (let i = 0; i < 9; i++) {
                const h = hash(i + seed), h2 = hash(i + seed + 0.5), ang = base + (h - 0.5) * 2.4, ux = Math.cos(ang), uy = Math.sin(ang);
                const reach = 16 + 34 * h2, head = q.r + reach * e, tail = q.r + reach * easeOut(Math.max(0, hu - 0.4));
                cx.strokeStyle = i % 3 ? '#fff' : col; cx.globalAlpha = 0.95 * a * flicker; cx.lineWidth = 1 + 2.2 * h2 * a;
                cx.beginPath(); line(q.x + ux * tail, q.y + uy * tail, q.x + ux * head, q.y + uy * head); cx.stroke();
            }
        }
        cx.restore();
    }
}
function arrowShape(x, y, ang, len, col, alpha) { // a plain rectangle: its leading end at (x, y), trailing back along ang
    cx.save();
    cx.globalAlpha = alpha;
    cx.translate(x, y); cx.rotate(ang);
    cx.fillStyle = col; cx.strokeStyle = '#e8e8e4'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.rect(-len, -ARROW_HALF_W, len, 2 * ARROW_HALF_W); cx.fill(); cx.stroke();
    cx.restore();
}
function arrowStreak(a, col) { // a curved streak behind an arrow in flight, following the real arc (position s seconds ago = pos - v*s + G*s^2/2)
    const sp = Math.hypot(a.vx, a.vy), k = clamp01((sp - 250) / 950); // 0 = slow, 1 = full-charge speed
    if (k <= 0.02)
        return;
    const rgb = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16)), white = rgb.map(v => Math.round(v + (255 - v) * 0.85));
    const N = 12, s0 = ARROW_LEN / sp, span = 0.05 + 0.1 * k, nx = -a.vy / sp, ny = a.vx / sp, pts = []; // the streak starts at the tail of the shaft
    for (let n = 0; n <= N; n++) {
        const s = s0 + span * n / N;
        pts.push({ x: a.x - a.vx * s, y: a.y - a.vy * s + 0.5 * ARROW_G * s * s });
    }
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round';
    for (const off of k > 0.5 ? [0, -1, 1] : [0]) { // thin side lanes at speed, converging toward the tail
        for (let n = 0; n < N; n++) {
            const age = n / N, t = Math.pow(1 - age, 1.3) * k, o = off * ARROW_HALF_W * 1.6 * (1 - age * 0.6), p0 = pts[n], p1 = pts[n + 1];
            const x1 = p0.x + nx * o, y1 = p0.y + ny * o, x2 = p1.x + nx * o, y2 = p1.y + ny * o;
            if (off === 0) { // soft wide glow under the main streak
                cx.strokeStyle = `rgba(${rgb},${0.3 * t})`;
                cx.lineWidth = (8 + 8 * k) * (1 - age * 0.8);
                cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
            }
            const m = k * (1 - age * 0.5), c = rgb.map((v, i) => Math.round(v + (white[i] - v) * m)); // team colour -> white-hot with speed
            cx.strokeStyle = `rgba(${c},${(off === 0 ? 0.85 : 0.5) * t})`;
            cx.lineWidth = (off === 0 ? 1.5 + 2.5 * k : 0.8 + 0.8 * k) * (1 - age * 0.85);
            cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
        }
    }
    cx.restore();
}
function drawArrows() {
    for (const a of arrows) {
        const col = a.team === 0 ? '#42a5f5' : '#ef5350';
        if (!a.stuck && !a.spent)
            arrowStreak(a, col);
        arrowShape(a.x, a.y, a.ang, ARROW_LEN, col, a.stuck ? Math.min(1, a.life / 0.5) : 1);
    }
}
function drawBoomerangs() {
    for (const b of boomerangs) {
        const col = b.team === 0 ? '#42a5f5' : '#ef5350', L = b.r * 2.1, e = -L * 0.45, tx = L * 0.45, ty = L * 0.78;
        cx.save();
        if (Math.hypot(b.vx, b.vy) > 1) { // faint streak along the flight
            cx.lineCap = 'round'; cx.strokeStyle = col; cx.globalAlpha = 0.35; cx.lineWidth = b.r * 1.4;
            cx.beginPath(); line(b.x - b.vx * 0.05, b.y - b.vy * 0.05, b.x, b.y); cx.stroke();
            cx.globalAlpha = 1;
        }
        cx.translate(b.x, b.y); cx.rotate(b.rot);
        cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(tx, -ty); cx.lineTo(e, 0); cx.lineTo(tx, ty);
        cx.strokeStyle = '#7a4d22'; cx.lineWidth = 8.4; cx.stroke();
        cx.strokeStyle = '#d9a066'; cx.lineWidth = 5.4; cx.stroke();
        cx.fillStyle = col;
        for (const sy of [-ty, ty]) { cx.beginPath(); cx.arc(tx, sy, 2.4, 0, 7); cx.fill(); }
        cx.restore();
    }
}
