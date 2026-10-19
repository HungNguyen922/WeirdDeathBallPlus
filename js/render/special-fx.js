// RENDER - special effects: Explode blast, Awakened aura and Warp markers. Read-only on game state.
function drawExplode() { // Explode: a crisp zone of exactly EXPLODE_R (brighter toward the middle, where the blast is strongest), a flash, two shock rings, motion lines bursting out of the blast point, and a streak behind every body that was hit
    const fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453); // a fixed pseudo-random value per line, so the burst looks the same every time without storing anything
    const clamp = v => Math.max(0, Math.min(1, v)), easeOut = u => 1 - (1 - u) * (1 - u);
    cx.save();
    cx.lineCap = 'round';
    for (const p of players) {
        const fx = p.explodeFx;
        if (!fx)
            continue;
        const col = p.team === 0 ? '#42a5f5' : '#ef5350', f = 1 - fx.t / EXPLODE_FX;
        const wave = Math.min(1, f / 0.35), e = easeOut(wave); // the first wave reaches the edge 35% of the way through
        const hold = f < 0.55 ? 1 : 1 - (f - 0.55) / 0.45; // the zone stays fully visible for 55% of the effect, then fades
        // the zone: brightest in the middle (where the push is strongest), faint at the edge
        const zg = cx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, EXPLODE_R);
        zg.addColorStop(0, col + 'aa'); zg.addColorStop(0.5, col + '44'); zg.addColorStop(1, col + '14');
        cx.globalAlpha = hold; cx.fillStyle = zg;
        cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R, 0, 7); cx.fill();
        // a hard white flash at the very start
        if (f < 0.2) {
            const u = f / 0.2;
            cx.globalAlpha = 0.9 * (1 - u); cx.fillStyle = '#fff';
            cx.beginPath(); cx.arc(fx.x, fx.y, p.r + (EXPLODE_R * 0.6) * easeOut(u), 0, 7); cx.fill();
        }
        // wave 1: a bright disc growing to the edge with a coloured front (never past EXPLODE_R)
        if (wave < 1) {
            cx.globalAlpha = 0.45 * (1 - wave); cx.fillStyle = '#fff';
            cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R * e, 0, 7); cx.fill();
            cx.globalAlpha = 1 - 0.6 * wave; cx.strokeStyle = col; cx.lineWidth = 5;
            cx.beginPath(); cx.arc(fx.x, fx.y, Math.max(1, EXPLODE_R * e - 2), 0, 7); cx.stroke();
        }
        // wave 2: a thinner ring that follows and carries on past the edge, fading
        const w2 = clamp((f - 0.1) / 0.6);
        if (w2 > 0 && w2 < 1) {
            cx.globalAlpha = 0.8 * (1 - w2); cx.strokeStyle = '#fff'; cx.lineWidth = 1 + 3 * (1 - w2);
            cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R * (0.5 + 0.9 * easeOut(w2)), 0, 7); cx.stroke();
        }
        // motion lines: streaks that burst out of the blast point, some reaching well past the zone
        cx.save();
        cx.globalCompositeOperation = 'lighter';
        const N = 18, r0 = p.r + 3;
        for (let i = 0; i < N; i++) {
            const h = hash(i), h2 = hash(i + 0.5), ang = (i / N) * Math.PI * 2 + (h - 0.5) * 0.28;
            const delay = 0.12 * h2, u = clamp((f - delay) / 0.7);
            if (u <= 0 || u >= 1)
                continue;
            const reach = EXPLODE_R * (0.9 + 0.9 * h), head = r0 + reach * easeOut(u), tail = r0 + reach * easeOut(Math.max(0, u - 0.4 - 0.2 * h2)); // the tail trails the head, so the line looks like it is shooting outward
            const a = Math.pow(1 - u, 1.2), ux = Math.cos(ang), uy = Math.sin(ang);
            cx.strokeStyle = col; cx.globalAlpha = 0.35 * a; cx.lineWidth = 7 * (1 - u * 0.6); // soft glow under the line
            cx.beginPath(); line(fx.x + ux * tail, fx.y + uy * tail, fx.x + ux * head, fx.y + uy * head); cx.stroke();
            cx.strokeStyle = '#fff'; cx.globalAlpha = 0.95 * a; cx.lineWidth = (1.2 + 2.2 * h2) * (1 - u * 0.7); // hot core
            cx.beginPath(); line(fx.x + ux * tail, fx.y + uy * tail, fx.x + ux * head, fx.y + uy * head); cx.stroke();
        }
        cx.restore();
        // the edge: a solid line whose OUTER side is exactly EXPLODE_R (drawn half a line-width inside it)
        const lw = 3;
        cx.globalAlpha = hold; cx.strokeStyle = '#fff'; cx.lineWidth = lw;
        cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R - lw / 2, 0, 7); cx.stroke();
        // every body that was inside when it went off: a flash ring where it was, and a streak behind it showing which way it was sent (longer = hit harder)
        for (const h of fx.hits || []) {
            cx.globalAlpha = 1 - f; cx.strokeStyle = '#fff'; cx.lineWidth = 3 * (1 - f) + 1;
            cx.beginPath(); cx.arc(h.x, h.y, h.r + 4 + 10 * f, 0, 7); cx.stroke();
            if (h.ux !== undefined) {
                const L = (26 + 90 * h.k) * (0.4 + 0.6 * easeOut(clamp(f / 0.3))) * (1 - f * 0.5);
                cx.strokeStyle = col; cx.globalAlpha = 0.45 * (1 - f); cx.lineWidth = 8 * (1 - f) + 2;
                cx.beginPath(); line(h.x, h.y, h.x - h.ux * L, h.y - h.uy * L); cx.stroke();
                cx.strokeStyle = '#fff'; cx.globalAlpha = 0.9 * (1 - f); cx.lineWidth = 2.5 * (1 - f) + 0.8;
                cx.beginPath(); line(h.x, h.y, h.x - h.ux * L, h.y - h.uy * L); cx.stroke();
            }
        }
    }
    cx.restore();
}
function drawAwakened() { // Awakened: a golden pulsing aura on a powered-up player, with a ring that drains as the time runs out
    const tm = performance.now();
    cx.save();
    for (const p of players) {
        if (!p.alive || !(p.awakeT > 0))
            continue;
        const left = p.awakeT / AWAKENED_T, pulse = 0.5 + 0.5 * Math.sin(tm / 90), fade = left < 0.2 ? 0.5 + 0.5 * Math.sin(tm / 60) : 1; // flickers when nearly spent
        cx.shadowColor = '#ffd35a'; cx.shadowBlur = 16;
        cx.globalAlpha = (0.55 + 0.3 * pulse) * fade; cx.strokeStyle = '#ffd35a'; cx.lineWidth = 2.5;
        cx.beginPath(); cx.arc(p.x, p.y, p.r + 11 + 2 * pulse, 0, 7); cx.stroke();
        cx.shadowBlur = 0; cx.globalAlpha = 1;
        drawTimer(p.x, p.y, p.r + 8, left, '#ffd35a');
    }
    cx.restore();
}
function drawWarps() { // Warp: the marker, the dashed line to it, and the rings left by a teleport (all in the owner's team colour; both teams see both markers)
    const tm = performance.now();
    cx.save();
    cx.lineCap = 'round';
    for (const p of players) {
        const col = p.team === 0 ? '#42a5f5' : '#ef5350', w = p.warp, fx = p.warpFx;
        if (w && p.alive) {
            const ready = p.cd.warp <= 0, pulse = 0.5 + 0.5 * Math.sin(tm / 160);
            cx.strokeStyle = col; cx.lineWidth = 1.6; cx.globalAlpha = ready ? 0.7 : 0.4;
            cx.setLineDash([7, 6]); cx.lineDashOffset = -(tm / 40) % 13; // marching dashes, from you to the spot
            cx.beginPath(); line(p.x, p.y, w.x, w.y); cx.stroke();
            cx.setLineDash([]); cx.lineDashOffset = 0;
            cx.globalAlpha = ready ? 0.65 + 0.35 * pulse : 0.45; cx.lineWidth = 2; // the marker: a dashed ghost of the player with a cross in the middle
            cx.setLineDash([4, 4]);
            cx.beginPath(); cx.arc(w.x, w.y, p.r, 0, 7); cx.stroke();
            cx.setLineDash([]);
            cx.beginPath(); line(w.x - 4, w.y, w.x + 4, w.y); line(w.x, w.y - 4, w.x, w.y + 4); cx.stroke();
            cx.globalAlpha = 1;
            if (!ready) // still cooling down: the ring around the marker fills until the teleport is available
                drawTimer(w.x, w.y, p.r + 5, 1 - p.cd.warp / WARP_COOLDOWN, col);
            else {
                cx.globalAlpha = 0.25 + 0.25 * pulse; cx.strokeStyle = col; cx.lineWidth = 2;
                cx.beginPath(); cx.arc(w.x, w.y, p.r + 5 + 3 * pulse, 0, 7); cx.stroke();
                cx.globalAlpha = 1;
            }
        }
        if (fx) { // departure: the ring collapses where you left. Arrival: reverse ripples shrink in and focus on where you land, then pop
            const f = 1 - fx.t / WARP_FX, easeOut = u => 1 - (1 - u) * (1 - u), fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453);
            cx.strokeStyle = col; cx.lineWidth = 3 * (1 - f) + 1; cx.globalAlpha = (1 - f) * 0.9;
            cx.beginPath(); cx.arc(fx.ax, fx.ay, p.r * (1 - 0.5 * f), 0, 7); cx.stroke();
            cx.save();
            cx.globalCompositeOperation = 'lighter';
            cx.lineCap = 'round';
            const R0 = p.r * 5, R1 = p.r * 0.6;
            for (let i = 0; i < 4; i++) { // staggered ripples, each one smaller than the last as it closes in
                const u = clamp01((f - i * 0.1) / 0.65);
                if (u <= 0 || u >= 1)
                    continue;
                const rad = R0 + (R1 - R0) * Math.pow(u, 1.6); // slow at first, then rushing inward
                cx.strokeStyle = i % 2 ? '#fff' : col; cx.globalAlpha = 0.25 + 0.7 * u; cx.lineWidth = 1 + 4 * u; // brighter and thicker as it focuses
                cx.beginPath(); cx.arc(fx.bx, fx.by, rad, 0, 7); cx.stroke();
            }
            for (let i = 0; i < 12; i++) { // suction lines streaming into the spot
                const h = hash(i), ang = (i / 12) * Math.PI * 2 + (h - 0.5) * 0.3, u = clamp01((f - 0.05 * h) / 0.7);
                if (u <= 0 || u >= 1)
                    continue;
                const head = R0 * 1.1 * (1 - easeOut(u)) + R1, tail = head + (14 + 22 * h) * (1 - u), ux = Math.cos(ang), uy = Math.sin(ang);
                cx.strokeStyle = i % 2 ? col : '#fff'; cx.globalAlpha = 0.9 * (1 - u * 0.5); cx.lineWidth = 1 + 2 * h;
                cx.beginPath(); line(fx.bx + ux * tail, fx.by + uy * tail, fx.bx + ux * head, fx.by + uy * head); cx.stroke();
            }
            const pop = clamp01((f - 0.65) / 0.35); // the focus: a flash and a small ring when the ripples land
            if (pop > 0) {
                cx.fillStyle = '#fff'; cx.globalAlpha = 0.8 * (1 - pop);
                cx.beginPath(); cx.arc(fx.bx, fx.by, p.r * (0.4 + 1.2 * Math.sin(Math.PI * pop)), 0, 7); cx.fill();
                cx.strokeStyle = col; cx.globalAlpha = 0.9 * (1 - pop); cx.lineWidth = 3 * (1 - pop) + 1;
                cx.beginPath(); cx.arc(fx.bx, fx.by, p.r * (1 + 1.2 * easeOut(pop)), 0, 7); cx.stroke();
            }
            cx.restore();
            cx.globalAlpha = 1;
        }
    }
    cx.restore();
}
