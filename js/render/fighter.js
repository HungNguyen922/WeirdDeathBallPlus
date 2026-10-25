// RENDER - Fighter: fireballs, and a hitbox preview while a move is running. Display only.
function drawFireballs() {
    const tm = performance.now();
    for (const f of fireballs) {
        const col = f.team === 0 ? '#42a5f5' : '#ef5350', pulse = 0.5 + 0.5 * Math.sin(tm / 60 + f.x * 0.05);
        cx.save();
        cx.globalCompositeOperation = 'lighter';
        cx.lineCap = 'round';
        cx.strokeStyle = col; cx.globalAlpha = 0.45; cx.lineWidth = f.r * 1.4; // the tail
        cx.beginPath(); line(f.x - f.dir * 46, f.y, f.x, f.y); cx.stroke();
        cx.globalAlpha = 0.8; cx.lineWidth = f.r * 0.6;
        cx.beginPath(); line(f.x - f.dir * 28, f.y, f.x, f.y); cx.stroke();
        const R = f.r * (1.5 + 0.2 * pulse), g = cx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.globalAlpha = 1; cx.fillStyle = g;
        cx.beginPath(); cx.arc(f.x, f.y, R, 0, 7); cx.fill();
        cx.restore();
    }
}
function drawFighterMoves() { // the move's hitbox: faint while winding up, bright while it can hurt
    for (const p of players) {
        const m = p.alive && p.move, mv = m && FIGHTER_BY_ID[m.id];
        const box = mv && (mv.sweep ? fighterSweep(p, m, mv) : mv.hit && fighterBox(p, mv.hit));
        if (!box)
            continue;
        const live = m.t >= mv.startup && m.t < mv.startup + mv.active;
        cx.save();
        cx.globalAlpha = live ? 0.55 : 0.18; cx.fillStyle = p.color; cx.strokeStyle = '#fff'; cx.lineWidth = live ? 2 : 1;
        cx.beginPath(); cx.arc(box.x, box.y, box.r, 0, 7); cx.fill(); if (live) cx.stroke();
        cx.restore();
    }
}

function drawStuns() { // a spinning yellow ring on stunned players
    const tm = performance.now();
    for (const p of players) {
        if (!p.alive || !(p.stunT > 0))
            continue;
        cx.save();
        cx.strokeStyle = '#ffd54a'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.setLineDash([6, 6]); cx.lineDashOffset = -tm / 25;
        cx.globalAlpha = 0.55 + 0.4 * Math.min(1, p.stunT / 0.3);
        cx.beginPath(); cx.arc(p.x, p.y, p.r + 8, 0, 7); cx.stroke();
        cx.restore();
    }
}