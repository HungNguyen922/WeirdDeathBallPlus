// RENDER - the special-ability pick screen: a fighting-game style select grid (PICK_COLS icons per row) with a round badge per player that glides from icon to icon, and a panel on the
// side for every player (one big panel for a team of one, two stacked panels for a team of two).
// Read-only on game state: everything it shows comes from `pick` (game/rules.js). Drawn over the playing area only, so the wall panels, the Menu tile and the score stay visible.
const PICK_DESC = { // two short lines under the highlighted special
    dash: ['A burst the way you steer.', 'Recharges on the floor.'],
    plinko: ['Drops a bouncy peg where', 'you stand. Two at a time.'],
    marionette: ['Hold, aim with the arrows,', 'release to shove the ball.'],
    decoy: ['Casts a lookalike ball that', 'never kills. One at a time.'],
    arrow: ['Hold to charge, release to', 'fire. Shoves ball and foes.'],
    bat: ['Hold to charge, release to', 'swing a half-circle.'],
    barbwire: ['Your grapple rope kills', 'any player it touches.'],
    warp: ['Press to mark a spot, press', 'again to teleport there.'],
    awakened: ['10 s of stronger grapple,', 'kicks and crash shots.'],
};
const pickSp = id => SPECIALS.find(a => a.id === id) || SPECIALS[0];
const PICK_NAMES = ['BLUE', 'RED', 'BLUE 2', 'RED 2']; // by player id
const PICK_CORNER = id => ({ x: id % 2, y: id >> 1 }); // which corner of an icon a player's badge sits on: Blue left, Red right, a team's first player on top, its second below
function drawPickBadge(x, y, p, ready, t) { // the player's marker: a round badge in the team colour with the player's number (1 or 2 in the team), a tick once locked in
    const pulse = ready ? 1 : 1 + 0.06 * Math.sin(t / 130 + p.id);
    cx.save();
    cx.translate(x, y); cx.scale(pulse, pulse);
    cx.fillStyle = p.color; cx.strokeStyle = '#0b0e12'; cx.lineWidth = 3;
    cx.beginPath(); cx.arc(0, 0, 11, 0, 7); cx.stroke(); cx.fill();
    cx.strokeStyle = 'rgba(255,255,255,.85)'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.arc(0, 0, 11, 0, 7); cx.stroke();
    cx.fillStyle = '#0b0e12'; cx.strokeStyle = '#0b0e12';
    if (ready) { // locked in: tick
        cx.lineWidth = 2.6; cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(-4.5, 0.5); cx.lineTo(-1, 4); cx.lineTo(5, -3.5); cx.stroke();
    } else {
        cx.font = 'bold 13px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(String((p.id >> 1) + 1), 0, 1);
    }
    cx.restore();
}
const PICK_ICON_EXT = 14; // how far (u, stroke included) any icon glyph reaches from its centre (the tallest are about 13): the name is placed below this
function drawPickPanel(p, x, y, w, h, compact) { // one player's panel: badge, name, big icon, what it does, and whether they are locked in
    const col = p.color, sp = pickSp(PICK_LIST[pick.cur[p.id]]), ready = pick.ready[p.id], mid = x + w / 2, tm = performance.now();
    const L = compact // two stacked panels on a side are the small version
        ? { title: 24, tf: 17, icon: 62, is: 2.6, nf: 14, dg: 16, ds: 13, df: 10.5, status: h - 12 }
        : { title: 32, tf: 22, icon: 92, is: 4.2, nf: 17, dg: 20, ds: 14, df: 11, status: h - 18 };
    L.name = L.icon + PICK_ICON_EXT * L.is + L.nf; // the name sits under the icon's lowest possible edge, so no icon can ever run into it
    L.desc = L.name + L.dg;
    cx.save();
    cx.fillStyle = 'rgba(255,255,255,.04)'; cx.strokeStyle = col; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(x, y, w, h, 10); cx.fill(); cx.stroke();
    cx.textAlign = 'center';
    cx.font = 'italic 800 ' + L.tf + 'px system-ui, sans-serif'; cx.fillStyle = col;
    cx.fillText(PICK_NAMES[p.id], mid, y + L.title);
    drawPickBadge(x + 24, y + L.title - L.tf * 0.35, p, ready, tm); // the same badge as on the grid, so the panel and the marker belong together
    cx.save(); cx.translate(mid, y + L.icon); cx.scale(L.is, L.is); iconGlyph(sp.icon, 0, 0, '#e8e8e4'); cx.restore();
    cx.textAlign = 'center';
    cx.font = 'bold ' + L.nf + 'px system-ui, sans-serif'; cx.fillStyle = '#fff';
    cx.fillText(sp.name, mid, y + L.name);
    cx.font = L.df + 'px system-ui, sans-serif'; cx.fillStyle = '#98a2ad';
    (PICK_DESC[sp.id] || []).forEach((l, i) => cx.fillText(l, mid, y + L.desc + i * L.ds));
    cx.font = 'bold ' + (compact ? 11 : 12) + 'px system-ui, sans-serif';
    cx.fillStyle = ready ? '#7ee787' : col;
    cx.fillText(ready ? 'LOCKED IN' : ai[p.id].on && !net.on ? 'AI' : 'CHOOSING...', mid, y + L.status);
    cx.restore();
}
const pickBadges = []; // where each player's badge is drawn right now ({ x, y } per player id): it eases toward the icon the player is on, so it glides from icon to icon. Screen-only state.
let pickBadgeAt = 0;
function drawPickScreen() {
    if (!pick.on) {
        pickBadges.length = 0; // the next screen starts with the badges on their icons
        return;
    }
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
    const dt = Math.min(0.1, (tm - pickBadgeAt) / 1000), ease = 1 - Math.exp(-dt * 14); // (a badge covers about 95% of the distance in 0.2 s)
    pickBadgeAt = tm;
    for (const p of players) { // one badge per player, sitting on its corner of the icon the player is on (so two players on the same icon never cover each other)
        const r = tileAt(pick.cur[p.id]), c = PICK_CORNER(p.id), tx = r.x + c.x * TS, ty = r.y + c.y * TS;
        const b = pickBadges[p.id] || (pickBadges[p.id] = { x: tx, y: ty }); // first frame: straight to its icon
        b.x += (tx - b.x) * ease;
        b.y += (ty - b.y) * ease;
        drawPickBadge(b.x, b.y, p, pick.ready[p.id], tm);
    }
    for (const t of [0, 1]) { // the side panels: a team of one gets the big panel, a team of two gets two small ones (first player on top)
        const list = players.filter(q => q.team === t), x = t === 0 ? 24 : W - 24 - 190;
        if (list.length === 1)
            drawPickPanel(list[0], x, 120, 190, 250, false);
        else
            list.forEach((p, i) => drawPickPanel(p, x, 96 + i * 182, 190, 170, true));
    }
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
