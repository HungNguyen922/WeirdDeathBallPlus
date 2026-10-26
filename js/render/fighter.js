function drawFighterMoves() { // the move's hitbox: faint while winding up, bright while it can hurt
    for (const p of players) {
        const m = p.alive && p.move, mv = m && FIGHTER_BY_ID[m.id];
        const box = mv && (mv.sweep ? fighterSweep(p, m, mv) : mv.hit && fighterBox(p, mv.hit, m.dir));
        if (!box)
            continue;
        const live = m.t >= mv.startup && m.t < mv.startup + mv.active;
        cx.save();
        cx.globalAlpha = live ? 0.55 : 0.18; cx.fillStyle = p.color; cx.strokeStyle = '#fff'; cx.lineWidth = live ? 2 : 1;
        cx.beginPath();
        if (box.rx) cx.ellipse(box.x, box.y, box.rx, box.ry, 0, 0, 7); else cx.arc(box.x, box.y, box.r, 0, 7);
        cx.fill(); if (live) cx.stroke();
        cx.restore();
    }
}

function drawStuns() { // a spinning yellow ring on stunned players
    const tm = performance.now();
    for (const p of players) {
        if (!p.alive || !(p.stunT > 0))
            continue;
        cx.save();
        cx.strokeStyle = '#ff984a'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.setLineDash([6, 6]); cx.lineDashOffset = -tm / 25;
        cx.globalAlpha = 0.55 + 0.4 * Math.min(1, p.stunT / 0.3);
        cx.beginPath(); cx.arc(p.x, p.y, p.r + 8, 0, 7); cx.stroke();
        cx.restore();
    }
}

function drawFacing(p) { // a short arc on the side the fighter faces
    if (!p.alive || !p.has('fighter'))
        return;
    const f = p.face >= 0 ? 1 : -1, a = 0.7, R = p.r + 6, c = f > 0 ? 0 : Math.PI; // (>= 0: online, face is blended between snapshots)
    cx.save();
    cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.lineCap = 'round'; cx.globalAlpha = 0.9;
    cx.beginPath(); cx.arc(p.x, p.y, R, c - a, c + a); cx.stroke();
    cx.restore();
}

const PROJ_DRAW = {
    chevron(p, col) { // a ‹ pointing along its heading
        cx.globalAlpha = Math.min(1, p.life / 0.2);
        cx.strokeStyle = col; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(-5, -6); cx.lineTo(3, 0); cx.lineTo(-5, 6); cx.stroke();
        cx.strokeStyle = '#fff'; cx.lineWidth = 1.2; cx.stroke();
    },
};
PROJ_DRAW.arrow = { world(a, col) {
    if (!a.stuck && !a.spent) arrowStreak(a, col);
    arrowShape(a.x, a.y, a.ang, ARROW_LEN, col, a.stuck ? Math.min(1, a.life / 0.5) : 1);
} };
PROJ_DRAW.boomerang = { world(b, col) {
    const L = b.r * 2.1, e = -L * 0.45, tx = L * 0.45, ty = L * 0.78;
    if (Math.hypot(b.vx, b.vy) > 1) {
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
} };
PROJ_DRAW.fireball = (f, col) => { // local frame: forward is +x, so the tail is -x
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 60 + f.x * 0.05), R = f.r * (1.5 + 0.2 * pulse);
    cx.globalCompositeOperation = 'lighter'; cx.lineCap = 'round'; cx.strokeStyle = col;
    cx.globalAlpha = 0.45; cx.lineWidth = f.r * 1.4; cx.beginPath(); line(-46, 0, 0, 0); cx.stroke();
    cx.globalAlpha = 0.8; cx.lineWidth = f.r * 0.6; cx.beginPath(); line(-28, 0, 0, 0); cx.stroke();
    const g = cx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.globalAlpha = 1; cx.fillStyle = g; cx.beginPath(); cx.arc(0, 0, R, 0, 7); cx.fill();
};
function drawProjectiles() {
    for (const p of projectiles) {
        const d = PROJ_DRAW[p.type];
        if (!d) continue;
        const col = p.team === 0 ? '#42a5f5' : '#ef5350';
        cx.save();
        if (d.world) d.world(p, col);
        else { cx.translate(p.x, p.y); cx.rotate(p.ang); d(p, col); }
        cx.restore();
    }
}