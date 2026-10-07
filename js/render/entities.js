// RENDER - everything that moves: pegs, abilities in progress, ropes, players, balls, banner. Read-only on game state.
function drawTimer(x, y, rad, frac, col) { // circular timer: faint full track plus an arc of the remaining fraction, starting at 12 o'clock
    cx.lineWidth = 2.5;
    cx.strokeStyle = 'rgba(255,255,255,.18)';
    cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.stroke();
    cx.strokeStyle = col;
    cx.beginPath(); cx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac); cx.stroke();
}
function drawPegs() { // plinko pegs
    for (const q of pegs) { // plinko pegs
        const col = q.team === 0 ? '#42a5f5' : '#ef5350';
        cx.globalAlpha = q.life < 2 ? 0.45 + 0.4 * Math.sin(q.life * 24) : 1; // flickers while fizzling out
        if (q.flash > 0) {
            cx.strokeStyle = col; cx.globalAlpha *= q.flash; cx.lineWidth = 2;
            cx.beginPath(); cx.arc(q.x, q.y, q.r + (1 - q.flash) * 14, 0, 7); cx.stroke();
            cx.globalAlpha = q.life < 2 ? 0.45 + 0.4 * Math.sin(q.life * 24) : 1;
        }
        cx.fillStyle = '#e8e8e4'; cx.strokeStyle = col; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(q.x, q.y, q.r - 1, 0, 7); cx.fill(); cx.stroke();
        drawTimer(q.x, q.y, q.r + 5, Math.max(0, q.life) / PEG_LIFE, col);
        cx.globalAlpha = 1;
    }
}
function arrowShape(x, y, ang, len, col, alpha) { // tip at (x, y), pointing along ang
    const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, tx = x - ux * len, ty = y - uy * len;
    cx.save();
    cx.globalAlpha = alpha; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.strokeStyle = '#e8e8e4'; cx.lineWidth = 2;
    cx.beginPath(); line(tx, ty, x, y); cx.stroke();
    cx.fillStyle = col;
    cx.beginPath(); cx.moveTo(x + ux * 3, y + uy * 3); cx.lineTo(x - ux * 7 + nx * 4.5, y - uy * 7 + ny * 4.5); cx.lineTo(x - ux * 7 - nx * 4.5, y - uy * 7 - ny * 4.5); cx.closePath(); cx.fill();
    cx.strokeStyle = col; cx.lineWidth = 1.6;
    for (const s of [-1, 1]) { cx.beginPath(); line(tx + ux * 6, ty + uy * 6, tx - ux * 2 + nx * 4 * s, ty - uy * 2 + ny * 4 * s); cx.stroke(); }
    cx.restore();
}
function drawArrows() {
    for (const a of arrows)
        arrowShape(a.x, a.y, a.ang, 22, a.team === 0 ? '#42a5f5' : '#ef5350', a.stuck ? Math.min(1, a.life / 0.5) : 1);
}
function drawAITags() { // "AI" tag over a computer-controlled player
    for (const p of players) { // "AI" tag over a computer-controlled player
        if (p.alive && ai[p.id].on) {
            cx.fillStyle = 'rgba(255,255,255,.8)';
            cx.font = 'bold 11px system-ui, sans-serif';
            cx.textAlign = 'center';
            cx.fillText('AI', p.x, p.y - p.r - 7);
        }
    }
}
function drawCasts() { // abilities being cast: ghost pegs / decoys, marionette aim, cast timers
    for (const p of players) { // casts in progress
        if (!p.alive || !p.cast)
            continue;
        const col = p.team === 0 ? '#42a5f5' : '#ef5350', prog = 1 - p.cast.t / p.cast.t0;
        if (p.cast.type === 'plinko') { // ghost peg at the spot, filling as the cast completes
            cx.globalAlpha = 0.55; cx.strokeStyle = col; cx.lineWidth = 2; cx.setLineDash([3, 3]);
            cx.beginPath(); cx.arc(p.cast.x, p.cast.y, PEG_R - 1, 0, 7); cx.stroke();
            cx.setLineDash([]);
            cx.globalAlpha = 1;
            drawTimer(p.cast.x, p.cast.y, PEG_R + 5, prog, col);
        } else if (p.cast.type === 'decoy') { // ghost ball at the spot, filling as the cast completes
            cx.globalAlpha = 0.55; cx.strokeStyle = '#b36bff'; cx.lineWidth = 2; cx.setLineDash([3, 3]);
            cx.beginPath(); cx.arc(p.cast.x, p.cast.y, BALL_R, 0, 7); cx.stroke();
            cx.setLineDash([]);
            cx.globalAlpha = 1;
            drawTimer(p.cast.x, p.cast.y, BALL_R + 5, prog, col);
        } else if (p.cast.type === 'arrow') { // charge ring (white and pulsing at full) and the arrow held out along the aim
            const c = p.cast, full = c.charge >= 1, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
            drawTimer(p.x, p.y, p.r + 6, c.charge, full ? '#ffffff' : col);
            arrowShape(p.x + Math.cos(c.ang) * (p.r + 40), p.y + Math.sin(c.ang) * (p.r + 40), c.ang, 12 + 26 * c.charge, col, full ? 0.7 + 0.3 * pulse : 1);
        } else {
            if (p.cast.type === 'marionette') { // aiming: a string from the caster to the ball, and an arrow on the ball showing where the shove will go
                const c = p.cast, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110), dirOn = c.hx || c.hy;
                cx.globalAlpha = 0.45; cx.strokeStyle = col; cx.lineWidth = 1.5; cx.setLineDash([4, 5]);
                cx.beginPath(); line(p.x, p.y, ball.x, ball.y); cx.stroke();
                cx.setLineDash([]);
                cx.globalAlpha = 0.5 + 0.4 * pulse; cx.lineWidth = 2; // pulsing ring on the caster: the key is held
                cx.beginPath(); cx.arc(p.x, p.y, p.r + 6, 0, 7); cx.stroke();
                if (dirOn) {
                    const m = Math.hypot(c.hx, c.hy), ux = c.hx / m, uy = c.hy / m, nx = -uy, ny = ux, a0 = ball.r + 8, a1 = a0 + 40 + 6 * pulse;
                    cx.globalAlpha = c.grace > 0 && !anyArrowHeld(p) ? 0.55 : 1; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round';
                    cx.beginPath();
                    line(ball.x + ux * a0, ball.y + uy * a0, ball.x + ux * a1, ball.y + uy * a1);
                    cx.moveTo(ball.x + ux * a1 - ux * 9 + nx * 6, ball.y + uy * a1 - uy * 9 + ny * 6);
                    cx.lineTo(ball.x + ux * a1, ball.y + uy * a1);
                    cx.lineTo(ball.x + ux * a1 - ux * 9 - nx * 6, ball.y + uy * a1 - uy * 9 - ny * 6);
                    cx.stroke();
                } else { // no direction yet: a dashed ring on the ball
                    cx.globalAlpha = 0.5; cx.lineWidth = 1.5; cx.setLineDash([3, 4]);
                    cx.beginPath(); cx.arc(ball.x, ball.y, ball.r + 8, 0, 7); cx.stroke();
                    cx.setLineDash([]);
                }
                cx.globalAlpha = 1;
            } else
                drawTimer(p.x, p.y, p.r + 6, prog, col);
        }
    }
}
function anyArrowHeld(p) { return !!(p.keys.l || p.keys.r || p.keys.up || p.keys.dn); }
function drawGrappleRange() { // range indicator when nothing is in reach
    for (const p of players) { // range indicator when nothing is in reach
        if (p.alive && p.keys.z && !p.rope && !p.inReach(ball)) {
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
function drawRopes() { // hook in flight, then the tether itself
    for (const p of players) { // hook in flight: the rope reaches out to the target during the landing delay
        if (p.alive && p.pending && p.keys.z) {
            const f = Math.min(1, 1 - p.pending.t / p.pending.t0);
            cx.strokeStyle = 'rgba(232,232,228,.8)';
            cx.lineWidth = 2;
            cx.beginPath();
            line(p.x, p.y, p.x + (p.pending.p.x - p.x) * f, p.y + (p.pending.p.y - p.y) * f);
            cx.stroke();
        }
    }
    for (const p of players) {
        if (p.alive && p.rope) {
            const dd = Math.hypot(p.rope.x - p.x, p.rope.y - p.y);
            // Always draw the tether while it exists (it used to hide while slack, which read as "the grapple didn't draw").
            // A slack floor/slope rope is just drawn fainter than a taut one.
            {
                const slack = !p.onBall && p.ropeGround && dd < p.len - 1;
                cx.strokeStyle = slack ? 'rgba(232,232,228,.45)' : '#e8e8e4';
                cx.lineWidth = 2;
                cx.beginPath();
                line(p.x, p.y, p.rope.x, p.rope.y);
                cx.stroke();
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
function drawDashStreaks() { // dash streaks
    for (const p of players) { // dash streaks
        if (p.alive && p.dashT > 0) {
            const f = p.dashT / DASH_FX, ux = p.dashDir[0], uy = p.dashDir[1], nx = -uy, ny = ux;
            cx.save();
            cx.globalCompositeOperation = 'lighter';
            cx.lineCap = 'round';
            cx.strokeStyle = p.color; cx.shadowColor = p.color; cx.shadowBlur = 12;
            for (const o of [-0.7, 0, 0.7]) {
                const len = (22 + 70 * f) * (o ? 0.8 : 1);
                cx.globalAlpha = 0.8 * f * (o ? 0.7 : 1);
                cx.lineWidth = o ? 2 : 6;
                cx.beginPath();
                line(p.x + nx * o * p.r, p.y + ny * o * p.r, p.x + nx * o * p.r - ux * len, p.y + ny * o * p.r - uy * len);
                cx.stroke();
            }
            cx.restore();
        }
    }
}
function drawPlayerTrails() { // speed lines behind living players (same effect as the death ball's)
    for (const p of players)
        if (p.alive)
            drawTrail(p);
}
function drawPlayers() { // the player discs
    for (const p of players) {
        cx.globalAlpha = p.alive ? 1 : 0.2;
        cx.fillStyle = p.color;
        cx.strokeStyle = '#fff';
        cx.lineWidth = p.keys.x ? 6 : 2;
        cx.beginPath();
        cx.arc(p.x, p.y, p.r, 0, 7);
        cx.fill();
        cx.stroke();
        cx.globalAlpha = 1;
    }
}
function drawBall(b) { // the Death Ball sprite (decoys use it too)
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260); // slow glow pulse
    const bgr = cx.createRadialGradient(b.x - 4, b.y - 4, 1, b.x, b.y, b.r);
    bgr.addColorStop(0, '#5a2a98');
    bgr.addColorStop(1, '#1b0837');
    cx.fillStyle = bgr;
    cx.strokeStyle = '#b36bff';
    cx.lineWidth = 3;
    cx.shadowColor = '#9333ea';
    cx.shadowBlur = 16 + 12 * pulse;
    cx.beginPath();
    cx.arc(b.x, b.y, b.r, 0, 7);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    cx.strokeStyle = 'rgba(235,215,255,.9)';
    cx.lineWidth = 2;
    cx.beginPath(); // spin marker
    line(b.x, b.y, b.x + Math.cos(b.th) * b.r, b.y + Math.sin(b.th) * b.r);
    cx.stroke();
}
function drawPull(b) { // marionette: a ring and streaks in the caster's color behind the ball, fading over MARIONETTE_FX
    const q = b.pull;
    if (!q || q.t <= 0)
        return;
    const f = q.t / MARIONETTE_FX, nx = -q.uy, ny = q.ux;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round';
    cx.strokeStyle = q.col; cx.shadowColor = q.col; cx.shadowBlur = 12;
    cx.globalAlpha = 0.7 * f; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(b.x, b.y, b.r + (1 - f) * 22, 0, 7); cx.stroke();
    for (const o of [-0.7, 0, 0.7]) {
        const len = (22 + 70 * f) * (o ? 0.8 : 1);
        cx.globalAlpha = 0.8 * f * (o ? 0.7 : 1);
        cx.lineWidth = o ? 2 : 6;
        cx.beginPath();
        line(b.x + nx * o * b.r, b.y + ny * o * b.r, b.x + nx * o * b.r - q.ux * len, b.y + ny * o * b.r - q.uy * len);
        cx.stroke();
    }
    cx.restore();
}
function drawBalls() { // speed lines, decoys, then the death ball on top
    drawTrail(ball);
    for (const d of decoys)
        drawTrail(d);
    for (const d of decoys) { // decoys look exactly like the death ball (under it), plus an optional ring in their caster's color
        drawBall(d);
        if (DECOY_TELL) {
            cx.save();
            cx.strokeStyle = d.team === 0 ? '#42a5f5' : '#ef5350'; cx.lineWidth = 2; cx.globalAlpha = 0.9;
            cx.setLineDash([4, 4]); cx.lineDashOffset = -performance.now() / 80;
            cx.beginPath(); cx.arc(d.x, d.y, d.r + 6, 0, 7); cx.stroke();
            cx.restore();
        }
    }
    drawBall(ball);
    drawPull(ball);
}
function drawMessage() { // round / match banner
    cx.textAlign = 'center';
    cx.font = 'bold 30px system-ui, sans-serif';
    if (msg) {
        cx.fillStyle = '#fff';
        cx.font = 'bold 34px system-ui, sans-serif';
        cx.fillText(msg, W / 2, H / 2 - 40);
    }
}
