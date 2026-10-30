// RENDER - web: every placed node and the lines joining them (a line joins each node to every OLDER node of the same owner, as in physics/web.js). Display only.
// Both teams see every web. A line brightens for a moment when something crosses it (the nodes' flash timers, set by the physics).
// No shadowBlur: stacked strokes, wide and faint under narrow and bright, make the glow for almost nothing.
function drawWebs() {
    const webs = statics.filter(s => s.type === 'web');
    if (!webs.length)
        return;
    const tm = performance.now();
    cx.save();
    cx.lineCap = 'round';
    for (const s of webs) {
        const col = s.team === 0 ? '#42a5f5' : '#ef5350';
        for (const o of webs) {
            if (o.owner !== s.owner || o.id >= s.id)
                continue;
            const f = Math.max(s.flash || 0, o.flash || 0);
            cx.strokeStyle = col; cx.globalAlpha = 0.16 + 0.3 * f; cx.lineWidth = 6 + 4 * f;
            cx.beginPath(); line(o.x, o.y, s.x, s.y); cx.stroke();
            cx.strokeStyle = '#e8e8e4'; cx.globalAlpha = 0.55 + 0.4 * f; cx.lineWidth = 1.4 + 1.6 * f;
            cx.beginPath(); line(o.x, o.y, s.x, s.y); cx.stroke();
        }
    }
    for (const s of webs) {
        const col = s.team === 0 ? '#42a5f5' : '#ef5350', f = s.flash || 0, pulse = 0.5 + 0.5 * Math.sin(tm / 300 + s.id), r = WEB_NODE_R * (1 + 0.5 * f);
        cx.globalAlpha = 1; cx.fillStyle = '#14181d'; cx.strokeStyle = col; cx.lineWidth = 2.5;
        cx.beginPath(); cx.arc(s.x, s.y, r, 0, 7); cx.fill(); cx.stroke();
        cx.fillStyle = '#fff'; cx.globalAlpha = 0.5 + 0.5 * pulse;
        cx.beginPath(); cx.arc(s.x, s.y, r * 0.35, 0, 7); cx.fill();
    }
    cx.restore();
}
