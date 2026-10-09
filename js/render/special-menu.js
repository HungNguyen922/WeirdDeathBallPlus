// RENDER - the special-ability dropdown next to each player's keycaps (hit-testing lives here too, so input.js can use it).
// ---- Special-ability dropdown: click the special keycap to open a list of ability icons, click one to equip it. Add new abilities to SPECIALS. ----
const SPECIALS = [
    { id: 'dash', name: 'DASH', icon: 'dash' },
    { id: 'plinko', name: 'PLINKO', icon: 'plinko' },
    { id: 'marionette', name: 'MARIONETTE', icon: 'marionette' },
    { id: 'decoy', name: 'DECOY', icon: 'decoy' },
    { id: 'arrow', name: 'ARROW', icon: 'arrow' },
    { id: 'bat', name: 'BAT', icon: 'bat' },
    { id: 'barbwire', name: 'BARBWIRE', icon: 'barbwire' },
];
const ui = { open: -1, hover: null }; // open = index of the player whose menu is open (-1 = none)
const hintX = i => (i === 0 ? -OX / 2 : W + OX / 2);
const spKey = i => ({ x: hintX(i) + 26, y: 195, w: 40, h: 40 }); // the special keycap (third key of the action row)
const spItem = (i, n) => ({ x: hintX(i) + 26, y: 240 + n * 32, w: 40, h: 32 }); // menu rows, directly under it
const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function uiHit(x, y) {
    if (ui.open >= 0)
        for (let n = 0; n < SPECIALS.length; n++)
            if (inRect(spItem(ui.open, n), x, y))
                return { type: 'item', i: ui.open, n };
    for (const i of [0, 1])
        if (inRect(spKey(i), x, y))
            return { type: 'key', i };
    return null;
}
function closeSpecialMenu() { ui.open = -1; }
function drawSpecialMenu() {
    if (ui.open < 0)
        return;
    const i = ui.open, p = players[i], col = p.color, r0 = spItem(i, 0), hv = ui.hover;
    cx.save();
    cx.fillStyle = '#12081f'; cx.strokeStyle = col; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(r0.x - 3, r0.y - 2, r0.w + 6, SPECIALS.length * 32 + 4, 8); cx.fill(); cx.stroke();
    SPECIALS.forEach((a, n) => {
        const r = spItem(i, n), hot = hv && hv.type === 'item' && hv.i === i && hv.n === n, sel = p.special === a.id;
        if (hot || sel) {
            cx.fillStyle = sel ? col + '66' : 'rgba(255,255,255,.12)';
            cx.beginPath(); cx.roundRect(r.x, r.y + 1, r.w, r.h - 2, 6); cx.fill();
        }
        cx.globalAlpha = a.locked ? 0.45 : 1;
        iconGlyph(a.icon, r.x + r.w / 2, r.y + r.h / 2, '#e8e8e4');
        cx.globalAlpha = 1;
        if (hot) { // name of the hovered ability, beside the menu
            cx.font = 'bold 9px system-ui, sans-serif'; cx.textAlign = 'right'; cx.fillStyle = '#e8e8e4';
            cx.fillText(a.name, r0.x - 9, r.y + r.h / 2 + 3);
        }
    });
    cx.restore();
}
