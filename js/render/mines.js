// RENDER - mines: every planted mine (a dome on its surface, bigger with a count when stacked), the ring that fills while one is being planted, and the blast ring. Display only.
function drawMines() {
    const tm = performance.now();
    cx.save();
    for (const m of mines) {
        const y = mineY(m), rad = MINE_DRAW_R + MINE_DRAW_STACK * (m.n - 1), col = m.owner ? m.owner.color : '#ffffff', blink = 0.5 + 0.5 * Math.sin(tm / (260 - 18 * m.n) + m.id);
        cx.save();
        cx.translate(m.x, y);
        cx.rotate(Math.atan2(m.nx, -m.ny)); // local "up" points out of the surface
        cx.beginPath(); cx.arc(0, 0, rad, Math.PI, 0); cx.closePath();
        cx.fillStyle = '#181d24'; cx.fill();
        cx.strokeStyle = col; cx.lineWidth = 2; cx.stroke();
        cx.beginPath(); cx.arc(0, -rad * 0.5, rad * 0.22 + 0.8 * m.flash, 0, 7); // the light on top (scales with the dome)
        cx.fillStyle = col; cx.globalAlpha = 0.35 + 0.65 * blink; cx.fill();
        cx.restore();
        if (m.flash > 0) { // a ring when it goes in
            cx.strokeStyle = col; cx.lineWidth = 2; cx.globalAlpha = m.flash * 0.8;
            cx.beginPath(); cx.arc(m.x, y, rad + 22 * (1 - m.flash), 0, 7); cx.stroke();
            cx.globalAlpha = 1;
        }
        if (m.n > 1) { // the stack count
            cx.fillStyle = '#ffffff'; 
            cx.font = 'bold ' + Math.max(11, Math.round(rad * 0.8)) + 'px system-ui, sans-serif'; // the stack count scales too
            cx.textAlign = 'center'; cx.textBaseline = 'middle';
            cx.fillText(m.n, m.x + m.nx * (rad + 9), y + m.ny * (rad + 9));
        }
    }
    for (const p of players) {
        for (const c of p.casts) // the ring that fills while a mine is being planted
            if (c.type === 'mine') {
                const f = 1 - c.t / c.t0, cy = c.y + mineLift(c);
                cx.strokeStyle = p.color; cx.lineWidth = 3; cx.lineCap = 'round';
                cx.globalAlpha = 0.25; cx.beginPath(); cx.arc(c.x, cy, MINE_DRAW_R + 6, 0, 7); cx.stroke();
                cx.globalAlpha = 0.9; cx.beginPath(); cx.arc(c.x, cy, MINE_DRAW_R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); cx.stroke();
                cx.globalAlpha = 1;
            }
        if (p.mineFx) { // the blast: a flash and a ring spreading out to MINE_R
            const u = 1 - p.mineFx.t / MINE_FX;
            for (const pt of p.mineFx.pts) {
                const R = MINE_R * (0.25 + 0.75 * Math.sqrt(u)), w = 3 + 1.5 * Math.sqrt(pt.n);
                cx.fillStyle = p.color; cx.globalAlpha = (1 - u) * 0.18;
                cx.beginPath(); cx.arc(pt.x, pt.y, R, 0, 7); cx.fill();
                cx.strokeStyle = '#ffffff'; cx.lineWidth = w; cx.globalAlpha = (1 - u) * 0.9;
                cx.beginPath(); cx.arc(pt.x, pt.y, R, 0, 7); cx.stroke();
                cx.strokeStyle = p.color; cx.lineWidth = w + 5; cx.globalAlpha = (1 - u) * 0.35;
                cx.beginPath(); cx.arc(pt.x, pt.y, R, 0, 7); cx.stroke();
            }
            cx.globalAlpha = 1;
        }
    }
    cx.restore();
}