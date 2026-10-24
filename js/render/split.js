// RENDER - split: your copies, with a faint link to the active body. The next copy a weight-swap would take control of gets a brighter ring. Display only.
function drawClones() {
    const tm = performance.now();
    for (const p of players) {
        if (!p.alive || !p.clones || !p.clones.length)
            continue;
        const sp = skinSprite(skinOf(p), p.color);
        p.clones.forEach((c, i) => {
            cx.save();
            cx.globalAlpha = 0.25; cx.strokeStyle = p.color; cx.lineWidth = 1.5; cx.setLineDash([4, 6]);
            cx.beginPath(); line(p.x, p.y, c.x, c.y); cx.stroke();
            cx.setLineDash([]);
            cx.globalAlpha = 1; cx.fillStyle = p.color; cx.strokeStyle = '#fff'; cx.lineWidth = 2;
            cx.beginPath(); cx.arc(c.x, c.y, c.r, 0, 7); cx.fill();
            if (sp)
                cx.drawImage(sp.inner, c.x - c.r, c.y - c.r, 2 * c.r, 2 * c.r);
            cx.stroke();
            if (sp && sp.outer)
                cx.drawImage(sp.outer, c.x - SKIN_EXTENT * c.r, c.y - SKIN_EXTENT * c.r, 2 * SKIN_EXTENT * c.r, 2 * SKIN_EXTENT * c.r);
            cx.globalAlpha = i === 0 ? 0.8 : 0.35; cx.strokeStyle = p.color; cx.lineWidth = 1.5; cx.setLineDash([3, 3]); cx.lineDashOffset = -tm / 90;
            cx.beginPath(); cx.arc(c.x, c.y, c.r + 4, 0, 7); cx.stroke();
            cx.restore();
        });
    }
}