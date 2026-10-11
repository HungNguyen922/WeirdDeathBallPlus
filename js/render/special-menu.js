// RENDER - the special-ability dropdown next to each player's keycaps (hit-testing lives here too, so input.js can use it), plus the Menu tile below Blue's keys.
// ---- Special-ability dropdown: click the special keycap to open a list of ability icons, click one to equip it. Add new abilities to SPECIALS. ----
const SPECIALS = [
    { id: 'dash', name: 'DASH', icon: 'dash' },
    { id: 'plinko', name: 'PLINKO', icon: 'plinko' },
    { id: 'marionette', name: 'MARIONETTE', icon: 'marionette' },
    { id: 'decoy', name: 'DECOY', icon: 'decoy' },
    { id: 'arrow', name: 'ARROW', icon: 'arrow' },
    { id: 'bat', name: 'BAT', icon: 'bat' },
    { id: 'barbwire', name: 'BARBWIRE', icon: 'barbwire' },
    { id: 'warp', name: 'WARP', icon: 'warp' },
    { id: 'awakened', name: 'AWAKENED', icon: 'awakened' },
    { id: 'explode', name: 'EXPLODE', icon: 'explode' },
];
const ui = { open: -1, hover: null }; // open = index of the player whose menu is open (-1 = none)
const hintX = i => (i === 0 ? -OX / 2 : W + OX / 2);
const spKey = i => ({ x: hintX(i) + 26, y: HINT_ACT_Y + HINT_DY - 20, w: 40, h: 40 }); // the special keycap (third key of the action row)
const spItem = (i, n) => ({ x: hintX(i) + 26, y: HINT_ACT_Y + HINT_DY + 25 + n * 32, w: 40, h: 32 }); // menu rows, directly under it
const menuKey = () => ({ x: W / 2 - 60, y: H + 111, w: 120, h: 24 }); // the Menu button: a pill on the floor, centred under the online status line
const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function uiHit(x, y) {
    if (ui.open >= 0)
        for (let n = 0; n < SPECIALS.length; n++)
            if (inRect(spItem(ui.open, n), x, y))
                return { type: 'item', i: ui.open, n };
    for (const i of [0, 1])
        if (!pickFixed && inRect(spKey(i), x, y))
            return { type: 'key', i };
    if (inRect(menuKey(), x, y))
        return { type: 'menu' };
    return null;
}
function closeSpecialMenu() { ui.open = -1; }
function drawMenuTile() { // the Menu button (the panel itself is page UI, see menu.js)
    const r = menuKey(), hot = !!(ui.hover && ui.hover.type === 'menu'), on = typeof gameMenu !== 'undefined' && gameMenu.isOpen();
    const col = on ? '#0b0e12' : hot ? '#ffffff' : '#e8e8e4', my = r.y + r.h / 2;
    cx.save();
    cx.fillStyle = on ? EDGE : hot ? '#2e1a52' : '#1a0e30';
    cx.strokeStyle = on ? '#fff' : hot ? '#c9b8f0' : '#a893d4';
    cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 8); cx.fill(); cx.stroke();
    cx.strokeStyle = col; cx.lineWidth = 2; cx.lineCap = 'round'; // hamburger icon
    cx.beginPath();
    for (const dy of [-4, 0, 4])
        line(r.x + 14, my + dy, r.x + 26, my + dy);
    cx.stroke();
    cx.textBaseline = 'middle';
    cx.textAlign = 'left';
    cx.font = 'bold 11px system-ui, sans-serif'; cx.fillStyle = col;
    cx.fillText('MENU', r.x + 34, my + 1);
    cx.textAlign = 'right';
    cx.font = 'bold 8px system-ui, sans-serif'; cx.fillStyle = on ? '#0b0e12' : '#98a2ad';
    cx.fillText('ESC', r.x + r.w - 10, my + 1); // the key that also opens it
    cx.restore();
}
function drawSpecialMenu() {
    if (ui.open < 0)
        return;
    const i = ui.open, p = allPlayers[i], col = p.color, r0 = spItem(i, 0), hv = ui.hover;
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
