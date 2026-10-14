// RENDER - the static arena: background, floor (follows the seesaw), goal juts, tunnels, hatchets, net.
function drawOutside() { // tunnels, threshold lines and hatchets, mirrored on both sides
    const tm = performance.now();
    cx.lineWidth = 3;
    cx.fillStyle = TERRAIN;
    cx.fillRect(0, H, W, PIT); // base under the arena floor
    for (const side of [0, 1]) {
        const s = side === 0 ? -1 : 1, base = side === 0 ? 0 : W, X = d => base + s * d, lift = sawY(base);
        col = teamColor(sideSwap(side)), far = slopeY(OUT_D) + lift, fp = [0, PAD_D0, OUT_D].map(d => [X(d), slopeY(d) + lift]);
        cx.fillStyle = TERRAIN; // solid mass over the tunnel...
        cx.fillRect(side === 0 ? -OX : W, 0, OX, GOAL_Y0);
        cx.beginPath(); // ...and under its sloped floor (it carries on past the threshold)
        fp.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y))); cx.lineTo(X(OX), far); cx.lineTo(X(OX), H + PIT); cx.lineTo(X(0), H + PIT);
        cx.closePath(); cx.fill();
        cx.fillStyle = '#07090c'; // void past the threshold
        cx.fillRect(Math.min(X(OUT_D), X(OX)), GOAL_Y0, OX - OUT_D, far - GOAL_Y0);
        const tg = cx.createLinearGradient(X(0), 0, X(OUT_D), 0); // tunnel glows in the defending team's color, stronger toward the line
        tg.addColorStop(0, col + '10'); tg.addColorStop(1, col + '38');
        cx.fillStyle = tg;
        cx.beginPath();
        cx.moveTo(X(0), GOAL_Y0); cx.lineTo(X(OUT_D), GOAL_Y0);
        for (let i = fp.length - 1; i >= 0; i--) cx.lineTo(fp[i][0], fp[i][1]);
        cx.closePath(); cx.fill();
        cx.strokeStyle = EDGE; cx.lineWidth = 3; // ceiling and floor outlines
        cx.beginPath();
        line(base, GOAL_Y0, X(OX), GOAL_Y0);
        fp.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y))); cx.lineTo(X(OX), far);
        cx.stroke();
        // threshold line
        const lf = hud.line[side];
        cx.save();
        cx.strokeStyle = col; cx.lineWidth = 4 + 6 * lf; cx.shadowColor = col; cx.shadowBlur = 14 + 26 * lf;
        cx.setLineDash(lf > 0.05 ? [] : [14, 8]);
        cx.beginPath(); line(X(OUT_D), GOAL_Y0, X(OUT_D), far); cx.stroke();
        cx.restore();
        // hatchet: the floor's 45-degree section, with a glowing plate on it facing up and out
        const A = padA(side), B = padB(side), pf = padFlash[side];
        const Tx = s * Math.cos(PAD_ANG), Ty = Math.sin(PAD_ANG), Nx = s * Math.sin(PAD_ANG), Ny = -Math.cos(PAD_ANG); // along the plate (outward/down) and its up-and-out normal
        cx.save();
        cx.shadowColor = '#ffb020'; cx.shadowBlur = 10 + 24 * pf;
        cx.fillStyle = '#ffb020';
        cx.beginPath();
        cx.moveTo(A.x, A.y + lift); cx.lineTo(B.x, B.y + lift); cx.lineTo(B.x - Nx * PAD_LIFT, B.y - Ny * PAD_LIFT + lift); cx.lineTo(A.x - Nx * PAD_LIFT, A.y - Ny * PAD_LIFT + lift);
        cx.closePath(); cx.fill();
        cx.fillStyle = 'rgba(255,255,255,' + 0.85 * pf + ')';
        cx.fill();
        cx.restore();
        const nch = Math.max(3, Math.round(PAD_LEN / 40)); // one chevron per ~40 u of plate
        for (let i = 0; i < nch; i++) { // chevrons pointing the way the hatchet launches
            const u = (i + 0.5) / nch, px = A.x + (B.x - A.x) * u + Nx * 13, py = A.y + (B.y - A.y) * u + lift + Ny * 13;
            cx.strokeStyle = 'rgba(255,205,90,' + (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tm / 140 - i * 1.1))) + ')';
            cx.lineWidth = 2.5;
            cx.beginPath();
            cx.moveTo(px - Tx * 6 - Nx * 4, py - Ty * 6 - Ny * 4);
            cx.lineTo(px + Nx * 4, py + Ny * 4);
            cx.lineTo(px + Tx * 6 - Nx * 4, py + Ty * 6 - Ny * 4);
            cx.stroke();
        }
    }
}
function drawArena() { // background, terrain, goals, net line
    cx.fillStyle = '#0b0e12'; // out of bounds
    cx.fillRect(-OX, 0, CW, H + PIT);
    cx.fillStyle = '#14181d';
    cx.fillRect(0, 0, W, H);
    cx.fillStyle = 'rgba(' + sideRgb(0) + ',' + TINT + ')'; // each side is lightly tinted in its team color
    cx.fillRect(0, 0, NETX, H);
    cx.fillStyle = 'rgba(' + sideRgb(1) + ',' + TINT + ')';
    cx.fillRect(NETX, 0, NETX, H);
    drawOutside();
    cx.fillStyle = TERRAIN;
    cx.strokeStyle = EDGE;
    cx.lineWidth = 3;
    const sl = sawY(0), sr = sawY(W); // each ramp lifts as one block (its pop weight is 1 over the whole ramp)
    for (const pts of [[[0, GOAL_Y1 + sl], [RUN, H + sl], [RUN, H], [0, H]], [[W, GOAL_Y1 + sr], [W - RUN, H + sr], [W - RUN, H], [W, H]], PEAK]) {
        cx.beginPath();
        pts.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y)));
        cx.closePath();
        cx.fill();
        if (pts === PEAK)
            cx.stroke();
        else {
            cx.beginPath();
            cx.moveTo(pts[0][0], pts[0][1]);
            cx.lineTo(pts[1][0], pts[1][1]);
            cx.stroke();
        }
    }
    cx.beginPath(); // the floor between the ramps follows the quake
    for (let x = RUN; x <= W - RUN; x += 8)
        x === RUN ? cx.moveTo(x, H + sawY(x)) : cx.lineTo(x, H + sawY(x));
    cx.lineTo(W - RUN, H);
    cx.lineTo(RUN, H);
    cx.closePath();
    cx.fill();
    cx.beginPath();
    for (let x = RUN; x <= W - RUN; x += 8)
        x === RUN ? cx.moveTo(x, H + sawY(x)) : cx.lineTo(x, H + sawY(x));
    cx.stroke();
    cx.fillStyle = TERRAIN; // the juts over the goals
    cx.fillRect(0, 0, PL, GOAL_Y0);
    cx.fillRect(W - PL, 0, PL, GOAL_Y0);
    drawKeyHints();
    cx.fillStyle = 'rgba(' + sideRgb(0) + ',.35)'
    cx.fillRect(0, GOAL_Y0, 10, GOAL_Y1 - GOAL_Y0);
    cx.fillStyle = 'rgba(' + sideRgb(1) + ',.35)'
    cx.fillRect(W - 10, GOAL_Y0, 10, GOAL_Y1 - GOAL_Y0);
    cx.strokeStyle = EDGE;
    cx.lineWidth = 6;
    cx.beginPath();
    line(0, 0, W, 0);
    line(0, H, W, H);
    line(0, GOAL_Y0, PL, GOAL_Y0); // goal juts
    line(PL, 0, PL, GOAL_Y0);
    line(W, GOAL_Y0, W - PL, GOAL_Y0);
    line(W - PL, 0, W - PL, GOAL_Y0);
    cx.stroke();
    cx.strokeStyle = 'rgba(255,255,255,.35)';
    cx.lineWidth = 3;
    cx.fillStyle = 'rgba(255,255,255,.07)'; // the gap at the top of the net: a faint lit doorway
    cx.fillRect(NETX - 5, 0, 10, NET_GAP);
    cx.setLineDash([6, 6]);
    cx.beginPath();
    line(NETX, NET_GAP, NETX, H); // the net only exists below its gap
    cx.stroke();
    cx.setLineDash([]);
    cx.strokeStyle = 'rgba(255,255,255,.75)'; // cap on the cut end, so the edge of the gap reads clearly
    cx.lineWidth = 4;
    cx.lineCap = 'round';
    cx.beginPath();
    line(NETX - 7, NET_GAP, NETX + 7, NET_GAP);
    cx.stroke();
    cx.lineCap = 'butt';
}




// QUAKE graphic (the seesaw floor popping up): dust rings and cracks where the slam landed, debris thrown up, a bright pulse racing along the floor to the end that
// pops, and dust and grit streaming off that raised end. Display only: it reads quakeFx (set by sawHit) and the live floor shape, and never writes anything.
function drawQuakeFx() {
    const q = quakeFx;
    if (q.t <= 0)
        return;
    const u = 1 - q.t / QUAKE_FX_T, s = q.s, hitSide = q.x < NETX ? 0 : 1, popSide = 1 - hitSide, fade = 1 - u;
    const fy = x => H + sawY(x); // the floor's surface at x, following the quake
    const rnd = (i, k) => { const t = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return t - Math.floor(t); }; // fixed "random" numbers: no flicker between frames
    cx.save();
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.shadowColor = 'rgba(255,240,200,.8)'; cx.shadowBlur = 8;
    // 1) where the slam landed: two flat shock rings, and cracks running down into the floor
    const hx = q.x, hy = fy(hx);
    for (let i = 0; i < 2; i++) {
        const v = Math.min(1, Math.max(0, (u - i * 0.12) / 0.55));
        if (v <= 0 || v >= 1) continue;
        cx.globalAlpha = (1 - v) * 0.85; cx.strokeStyle = i ? '#cfc4a8' : '#fff6dc'; cx.lineWidth = 1.5 + 3.5 * (1 - v);
        cx.beginPath(); cx.ellipse(hx, hy, 14 + v * (80 + 110 * s), 3 + v * (8 + 9 * s), 0, Math.PI, 2 * Math.PI); cx.stroke();
    }
    cx.shadowBlur = 0; cx.strokeStyle = '#fff6dc'; cx.lineWidth = 1.5; cx.globalAlpha = fade * fade * 0.7;
    for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.18 + 0.64 * i / 4) + (rnd(i, 1) - 0.5) * 0.2, len = (16 + 26 * s) * (0.6 + 0.6 * rnd(i, 2)), m = len * 0.5;
        cx.beginPath(); cx.moveTo(hx, hy + 1);
        cx.lineTo(hx + Math.cos(a) * m + (rnd(i, 3) - 0.5) * 6, hy + Math.sin(a) * m);
        cx.lineTo(hx + Math.cos(a) * len, hy + Math.sin(a) * len); cx.stroke();
    }
    // 2) debris thrown up from the impact (simple ballistic arcs)
    const t = u * QUAKE_FX_T;
    cx.fillStyle = '#d8cfb8';
    for (let i = 0; i < 4 + Math.round(6 * s); i++) {
        const vx = (rnd(i, 4) - 0.5) * 220, vy = -(90 + 200 * rnd(i, 5)) * (0.5 + 0.7 * s);
        const x = hx + vx * t, y = hy - 2 + vy * t + 300 * t * t;
        if (y > fy(x)) continue; // it has landed in the floor
        cx.globalAlpha = Math.min(1, fade * 1.6); cx.save(); cx.translate(x, y); cx.rotate(t * (6 + 10 * rnd(i, 6)));
        const w = 2 + 2.5 * rnd(i, 7); cx.fillRect(-w / 2, -w / 2, w, w * 0.7); cx.restore();
    }
    // 3) the pulse: a bright streak racing along the floor from the hit to the end that pops
    const tx = popSide === 1 ? W - 60 : 60, run = Math.min(1, u / 0.35), px = hx + (tx - hx) * run, dir = Math.sign(tx - hx) || 1;
    cx.shadowColor = '#fff2c0'; cx.shadowBlur = 10; cx.strokeStyle = '#fff6dc'; cx.lineWidth = 5 - 2.5 * u; cx.globalAlpha = Math.min(1, fade * 1.3) * (0.6 + 0.4 * s);
    cx.beginPath();
    for (let x = px, n = 0; n <= 16 && (x - hx) * dir >= 0; x -= dir * 8, n++)
        n === 0 ? cx.moveTo(x, fy(x) - 2) : cx.lineTo(x, fy(x) - 2);
    cx.stroke();
    // 4) the popping end: grit and dust streaming up off the raised floor, and a glow on its edge, once the pulse gets there
    const arrive = Math.min(1, Math.max(0, (u - 0.25) / 0.2)), x0 = popSide === 1 ? W - SAW_HALF / 2 : 0, span = SAW_HALF / 2;
    if (arrive > 0) {
        const lift = Math.min(1, sawQ(popSide) / 14);
        cx.shadowBlur = 8; cx.strokeStyle = '#fff2c0'; cx.lineWidth = 3; cx.globalAlpha = arrive * Math.min(1, fade * 1.4) * (0.4 + 0.6 * lift);
        cx.beginPath(); for (let x = x0; x <= x0 + span; x += 8) x === x0 ? cx.moveTo(x, fy(x) - 3) : cx.lineTo(x, fy(x) - 3); cx.stroke();
        cx.shadowBlur = 0; cx.fillStyle = '#e8e0cc';
        for (let i = 0; i < 6 + Math.round(8 * s); i++) {
            const ph = (u * 1.6 + rnd(i, 8)) % 1, x = x0 + span * rnd(i, 9) + (rnd(i, 10) - 0.5) * 16 * ph, y = fy(x) - 4 - ph * (26 + 34 * s) * (0.5 + rnd(i, 11));
            cx.globalAlpha = arrive * Math.min(1, fade * 1.5) * (1 - ph) * 0.95;
            cx.beginPath(); cx.arc(x, y, 1.8 + 3 * ph * rnd(i, 12), 0, 7); cx.fill();
        }
        cx.strokeStyle = '#fff6dc'; cx.lineWidth = 2.2; // speed lines straight up off the raised end
        for (let i = 0; i < 5; i++) {
            const x = x0 + span * (0.1 + 0.8 * i / 4), ph = (u * 2 + i * 0.37) % 1, y = fy(x) - 8 - ph * 30 * (0.5 + s);
            cx.globalAlpha = arrive * Math.min(1, fade * 1.5) * (1 - ph) * (0.35 + 0.5 * lift);
            cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x, y - 6 - 8 * s); cx.stroke();
        }
    }
    cx.restore();
}
