// RENDER - HUD strip across the top: score bars and the center plaque.
// ---- HUD: fighting-game style strip across the top; the bars are progress toward WIN points (they fill from the outer edge toward the middle) ----
const hud = { shown: [0, 0], flash: [0, 0], line: [0, 0] }; // shown = smoothed fill (0..1); flash = brief glow after a point
function barPath(x, y, w, h, side, sk) { // slanted inner end, like the health bars in a fighting game
    cx.beginPath();
    if (side === 0) { cx.moveTo(x, y); cx.lineTo(x + w, y); cx.lineTo(x + w - sk, y + h); cx.lineTo(x, y + h); }
    else { cx.moveTo(x, y); cx.lineTo(x + w, y); cx.lineTo(x + w, y + h); cx.lineTo(x + sk, y + h); }
    cx.closePath();
}
function drawBar(side, color, name, frac, flash) {
    const bw = 480, bh = 28, by = 14, sk = 14, bx = side === 0 ? 24 : CW - 24 - bw;
    cx.save();
    barPath(bx, by, bw, bh, side, sk);
    cx.fillStyle = '#0b0e12'; // empty track
    cx.fill();
    cx.globalAlpha = 0.14;
    cx.fillStyle = color;
    cx.fill();
    cx.globalAlpha = 1;
    cx.save();
    cx.clip();
    const fw = bw * frac, fx = side === 0 ? bx : bx + bw - fw;
    if (fw > 0) {
        const g = cx.createLinearGradient(0, by, 0, by + bh);
        g.addColorStop(0, '#fff'); g.addColorStop(0.18, color); g.addColorStop(1, color);
        cx.fillStyle = g;
        cx.fillRect(fx, by, fw, bh);
        cx.fillStyle = 'rgba(255,255,255,' + (0.5 * flash) + ')'; // point-scored flash
        cx.fillRect(fx, by, fw, bh);
        const ex = side === 0 ? fx + fw : fx; // glowing leading edge
        cx.shadowColor = color; cx.shadowBlur = 12;
        cx.fillStyle = '#fff';
        cx.fillRect(ex - 1.5, by, 3, bh);
        cx.shadowBlur = 0;
    }
    cx.fillStyle = 'rgba(255,255,255,.12)'; // gloss
    cx.fillRect(bx, by, bw, bh / 2);
    cx.strokeStyle = 'rgba(0,0,0,.6)'; // one notch per point
    cx.lineWidth = 2;
    cx.beginPath();
    for (let i = 1; i < WIN; i++) line(bx + bw * i / WIN, by, bx + bw * i / WIN, by + bh);
    cx.stroke();
    // >>> extra bar effects (sparks, shimmer, particles...) can be drawn here: they are clipped to the bar, with fw/fx/frac available <<<
    cx.restore();
    barPath(bx, by, bw, bh, side, sk);
    cx.strokeStyle = '#d5dbe1'; cx.lineWidth = 3;
    cx.stroke();
    cx.font = 'italic 800 22px system-ui, sans-serif'; // fighter name under the bar
    cx.textAlign = side === 0 ? 'left' : 'right';
    cx.lineWidth = 4; cx.strokeStyle = '#000'; cx.lineJoin = 'round';
    cx.strokeText(name, side === 0 ? bx : bx + bw, 68);
    cx.fillStyle = color;
    cx.fillText(name, side === 0 ? bx : bx + bw, 68);
    cx.restore();
}
function drawHud() {
    const bg = cx.createLinearGradient(0, 0, 0, HUD);
    bg.addColorStop(0, '#05070a'); bg.addColorStop(1, '#10151b');
    cx.fillStyle = bg;
    cx.fillRect(0, 0, CW, HUD);
    for (const t of [0, 1]) {
        hud.shown[t] += (Math.min(1, score[t] / WIN) - hud.shown[t]) * 0.08;
        hud.flash[t] *= 0.94;
        padFlash[t] *= 0.9; // physics sets it on a hatchet hit; we fade it
        hud.line[t] *= 0.96;
    }
    drawBar(0, '#42a5f5', 'BLUE', hud.shown[0], hud.flash[0]);
    drawBar(1, '#ef5350', 'RED', hud.shown[1], hud.flash[1]);
    const cw = 128, ch = 50, x = CW / 2 - cw / 2, y = 8; // center plaque
    cx.fillStyle = '#0b0e12'; cx.strokeStyle = '#d5dbe1'; cx.lineWidth = 3;
    cx.beginPath(); cx.roundRect(x, y, cw, ch, 6); cx.fill(); cx.stroke();
    cx.textAlign = 'center';
    cx.font = 'bold 10px system-ui, sans-serif';
    cx.fillStyle = '#98a2ad';
    cx.fillText('FIRST TO ' + WIN, CW / 2, y + 15);
    cx.font = 'bold 28px system-ui, sans-serif';
    cx.fillStyle = '#42a5f5'; cx.fillText(String(score[0]), CW / 2 - 32, y + 43);
    cx.fillStyle = '#e8e8e4'; cx.fillText('-', CW / 2, y + 41);
    cx.fillStyle = '#ef5350'; cx.fillText(String(score[1]), CW / 2 + 32, y + 43);
    cx.strokeStyle = '#8a94a0'; cx.lineWidth = 3; // seam between HUD and arena
    cx.beginPath(); line(0, HUD, CW, HUD); cx.stroke();
}
