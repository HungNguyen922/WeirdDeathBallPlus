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
