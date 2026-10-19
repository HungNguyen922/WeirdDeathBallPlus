// RENDER - grapple ropes: the range ring, the hook in flight, the tether and the barbed wire. Read-only on game state.
function anyArrowHeld(p) { return !!(p.keys.l || p.keys.r || p.keys.up || p.keys.dn); }
function drawGrappleRange() { // range indicator when nothing is in reach
    for (const p of players) { // range indicator when nothing is in reach
        if (p.alive && p.keys.z && p.gCool <= 0 && !p.rope && !p.inReach(ball)) {
            cx.strokeStyle = p.keys.z ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.22)';
            cx.lineWidth = 2;
            cx.setLineDash([8, 8]);
            cx.beginPath();
            cx.arc(p.x, p.y, RANGE, 0, 7);
            cx.stroke();
            cx.setLineDash([]);
        }
    }
}
function barbs(x1, y1, x2, y2, col) { // little X-shaped barbs along a lethal rope, one every BARB_GAP u, drifting slowly so it reads as live wire
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    if (d < 4)
        return;
    const ux = dx / d, uy = dy / d, nx = -uy, ny = ux, BARB_GAP = 14, S = 4.5, off = (performance.now() / 60) % BARB_GAP;
    cx.save();
    cx.strokeStyle = col; cx.lineWidth = 1.8; cx.lineCap = 'round';
    cx.beginPath();
    for (let t = off; t < d - 2; t += BARB_GAP) {
        const bx = x1 + ux * t, by = y1 + uy * t;
        cx.moveTo(bx - ux * S + nx * S, by - uy * S + ny * S); cx.lineTo(bx + ux * S - nx * S, by + uy * S - ny * S);
        cx.moveTo(bx - ux * S - nx * S, by - uy * S - ny * S); cx.lineTo(bx + ux * S + nx * S, by + uy * S + ny * S);
    }
    cx.stroke();
    cx.restore();
}
const isBarbed = p => !!p.casting('barbwire');
function drawRopes() { // hook in flight, then the tether itself (barbed while the owner holds Barbwire)
    for (const p of players) { // hook in flight: the rope reaches out to the target during the landing delay
        if (p.alive && p.pending && p.keys.z) {
            const f = Math.min(1, 1 - p.pending.t / p.pending.t0), ex = p.x + (p.pending.p.x - p.x) * f, ey = p.y + (p.pending.p.y - p.y) * f;
            cx.strokeStyle = isBarbed(p) ? '#e8e8e4' : 'e8e8e4';
            cx.lineWidth = 2;
            cx.beginPath();
            line(p.x, p.y, ex, ey);
            cx.stroke();
            if (isBarbed(p))
                barbs(p.x, p.y, ex, ey, '#e8e8e4');
        }
    }
    for (const p of players) {
        if (p.alive && p.rope) {
            const dd = Math.hypot(p.rope.x - p.x, p.rope.y - p.y);
            // Always draw the tether while it exists (it used to hide while slack, which read as "the grapple didn't draw").
            // A slack floor/slope rope is just drawn fainter than a taut one.
            {
                const slack = !p.onBall && p.ropeGround && dd < p.len - 1, barbed = isBarbed(p);
                if (barbed) { // red glow under the wire
                    cx.save();
                    cx.strokeStyle = '#2d104b'; cx.lineWidth = 7; cx.lineCap = 'round';
                    cx.beginPath(); line(p.x, p.y, p.rope.x, p.rope.y); cx.stroke();
                    cx.restore();
                }
                cx.strokeStyle = barbed ? '#b36bff' : slack ? 'rgba(232,232,228,.45)' : '#e8e8e4';
                cx.lineWidth = 2;
                cx.beginPath();
                line(p.x, p.y, p.rope.x, p.rope.y);
                cx.stroke();
                if (barbed)
                    barbs(p.x, p.y, p.rope.x, p.rope.y, '#000000');
            }
            {
                cx.fillStyle = '#e8e8e4';
                cx.beginPath();
                cx.arc(p.rope.x, p.rope.y, p.onBall ? 4 : HOOK_R, 0, 7);
                cx.fill();
            }
        }
    }
}
