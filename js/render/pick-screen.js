// RENDER - the special-ability pick screen: a fighting-game style select grid (PICK_COLS icons per row) with a cursor per player and a panel for each team.
// Read-only on game state: everything it shows comes from `pick` (game/rules.js). Drawn over the playing area only, so the wall panels, the Menu tile and the score stay visible.
const PICK_DESC = { // two short lines under the highlighted special
    dash: ['A burst the way you steer.', 'Recharges on the floor.'],
    plinko: ['Drops a bouncy peg where', 'you stand. Two at a time.'],
    marionette: ['Hold, aim with the arrows,', 'release to shove the ball.'],
    decoy: ['Casts a lookalike ball that', 'never kills. One at a time.'],
    arrow: ['Hold to charge, release to', 'fire. Shoves ball and foes.'],
    bat: ['Hold to charge, release to', 'swing a half-circle.'],
    barbwire: ['Your grapple rope kills', 'any player it touches.'],
};
const pickSp = id => SPECIALS.find(a => a.id === id) || SPECIALS[0];
function drawPickPanel(t, x, y, w, h) { // one team's panel: big icon, name, what it does, and whether they are locked in
    const p = allPlayers[t], col = p.color, sp = pickSp(PICK_LIST[pick.cur[t]]), ready = pick.ready[t], mid = x + w / 2;
    cx.save();
    cx.fillStyle = 'rgba(255,255,255,.04)'; cx.strokeStyle = col; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(x, y, w, h, 10); cx.fill(); cx.stroke();
    cx.textAlign = 'center';
    cx.font = 'italic 800 22px system-ui, sans-serif'; cx.fillStyle = col;
    cx.fillText(t === 0 ? 'BLUE' : 'RED', mid, y + 32);
    cx.save(); cx.translate(mid, y + 92); cx.scale(4.2, 4.2); iconGlyph(sp.icon, 0, 0, '#e8e8e4'); cx.restore();
    cx.font = 'bold 17px system-ui, sans-serif'; cx.fillStyle = '#fff';
    cx.fillText(sp.name, mid, y + 146);
    cx.font = '11px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    (PICK_DESC[sp.id] || []).forEach((l, i) => cx.fillText(l, mid, y + 166 + i * 14));
    const mate = allPlayers[t + 2]; // 2v2: the teammate's pick, small
    if (mate && players.includes(mate)) {
        cx.font = 'bold 10px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
        cx.fillText('TEAMMATE: ' + pickSp(PICK_LIST[pick.cur[t + 2]]).name + (pick.ready[t + 2] ? ' \u2713' : ' ...'), mid, y + h - 40);
    }
    cx.font = 'bold 12px system-ui, sans-serif';
    cx.fillStyle = ready ? '#7ee787' : col;
    cx.fillText(ready ? 'LOCKED IN' : ai[t].on ? 'AI' : 'CHOOSING...', mid, y + h - 18);
    cx.restore();
}
function drawPickScreen() {
    if (!pick.on)
        return;
    const TS = 80, GAP = 14, n = PICK_LIST.length, gx = W / 2 - (PICK_COLS * TS + (PICK_COLS - 1) * GAP) / 2, gy = 150, tm = performance.now();
    const tileAt = k => { // the last row may be shorter: centre it
        const row = Math.floor(k / PICK_COLS), len = Math.min(PICK_COLS, n - row * PICK_COLS);
        return { x: gx + (PICK_COLS - len) * (TS + GAP) / 2 + (k % PICK_COLS) * (TS + GAP), y: gy + row * (TS + GAP) };
    };
    cx.save();
    cx.fillStyle = 'rgba(9,5,18,.93)'; // backdrop over the playing area, with a wash of each team's colour at its edge
    cx.fillRect(0, 0, W, H);
    const wash = cx.createLinearGradient(0, 0, W, 0);
    wash.addColorStop(0, 'rgba(66,165,245,.22)'); wash.addColorStop(0.4, 'rgba(66,165,245,0)');
    wash.addColorStop(0.6, 'rgba(239,83,80,0)'); wash.addColorStop(1, 'rgba(239,83,80,.22)');
    cx.fillStyle = wash;
    cx.fillRect(0, 0, W, H);
    cx.textAlign = 'center';
    cx.font = 'italic 800 30px system-ui, sans-serif';
    cx.lineWidth = 5; cx.strokeStyle = '#000'; cx.lineJoin = 'round';
    cx.strokeText('CHOOSE YOUR SPECIAL', W / 2, 70);
    cx.fillStyle = '#fff';
    cx.fillText('CHOOSE YOUR SPECIAL', W / 2, 70);
    cx.font = 'bold 12px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    cx.fillText(pick.at === 0 ? 'BEFORE THE FIRST POINT' : 'AFTER ' + pick.at + ' POINTS', W / 2, 96);
    for (let k = 0; k < n; k++) { // the grid
        const r = tileAt(k), sp = pickSp(PICK_LIST[k]);
        cx.fillStyle = '#1a0e30'; cx.strokeStyle = '#4b2f7a'; cx.lineWidth = 2;
        cx.beginPath(); cx.roundRect(r.x, r.y, TS, TS, 10); cx.fill(); cx.stroke();
        cx.save(); cx.translate(r.x + TS / 2, r.y + TS / 2 - 6); cx.scale(2.3, 2.3); iconGlyph(sp.icon, 0, 0, '#e8e8e4'); cx.restore();
        cx.font = 'bold 9px system-ui, sans-serif'; cx.fillStyle = '#98a2ad'; cx.textAlign = 'center';
        cx.fillText(sp.name, r.x + TS / 2, r.y + TS - 9);
    }
    for (const p of players) { // one cursor frame per player (each a little further out), filled and ticked once locked in
        const r = tileAt(pick.cur[p.id]), ready = pick.ready[p.id], o = 2 + 3 * p.id;
        if (ready) {
            cx.globalAlpha = 0.22; cx.fillStyle = p.color;
            cx.beginPath(); cx.roundRect(r.x, r.y, TS, TS, 10); cx.fill();
        }
        cx.globalAlpha = ready ? 1 : 0.65 + 0.35 * Math.sin(tm / 130 + p.id);
        cx.strokeStyle = p.color; cx.lineWidth = 3;
        cx.beginPath(); cx.roundRect(r.x - o, r.y - o, TS + 2 * o, TS + 2 * o, 10 + o); cx.stroke();
        cx.globalAlpha = 1;
        if (ready) {
            cx.save(); cx.translate(r.x + 14 + 15 * p.id, r.y + 14);
            cx.strokeStyle = p.color; cx.lineWidth = 3; cx.lineCap = 'round'; cx.lineJoin = 'round';
            cx.beginPath(); cx.moveTo(-5, 0); cx.lineTo(-1.5, 4); cx.lineTo(5, -4); cx.stroke();
            cx.restore();
        }
    }
    drawPickPanel(0, 24, 120, 190, 250);
    drawPickPanel(1, W - 24 - 190, 120, 190, 250);
    cx.textAlign = 'center';
    cx.font = 'bold 11px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    cx.fillText('ARROWS: MOVE     GRAPPLE OR SPECIAL: LOCK IN     WEIGHT: TAKE BACK', W / 2, 424);
    if (pick.go > 0) { // everybody is in: the countdown before the point
        cx.font = 'italic 800 34px system-ui, sans-serif'; cx.fillStyle = '#fff';
        cx.globalAlpha = 0.65 + 0.35 * Math.sin(tm / 60);
        cx.fillText('GET READY', W / 2, 372);
    }
    cx.restore();
}
