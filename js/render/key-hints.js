// RENDER - control hints drawn on the wall mass beside each goal (keycaps light up while held).
// ---- Control hints, drawn on the solid wall mass beside each goal. Keys light up in the player's color while held. ----
function keyCap(x, y, size, col, on, dim) { // returns the y the cap's face is drawn at (pressed keys sink 2px)
    const yy = y + (on ? 2 : 0);
    cx.save();
    cx.globalAlpha = dim ? 0.35 : 1;
    cx.fillStyle = '#0d1115';
    cx.beginPath(); cx.roundRect(x - size / 2, y - size / 2 + 3, size, size, 7); cx.fill();
    cx.fillStyle = on ? col : '#2e2146';
    cx.strokeStyle = on ? '#fff' : '#a893d4';
    cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(x - size / 2, yy - size / 2, size, size, 7); cx.fill(); cx.stroke();
    cx.restore();
    return yy;
}
function arrowGlyph(x, y, ang, color) {
    cx.save();
    cx.translate(x, y); cx.rotate(ang);
    cx.strokeStyle = color; cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.beginPath();
    cx.moveTo(0, 7); cx.lineTo(0, -7);
    cx.moveTo(-5, -2); cx.lineTo(0, -7); cx.lineTo(5, -2);
    cx.stroke();
    cx.restore();
}
function iconGlyph(kind, x, y, color) { // little icons: grapple hook, kettlebell weight, double chevron for dash
    cx.save();
    cx.translate(x, y);
    cx.strokeStyle = color; cx.fillStyle = color; cx.lineWidth = 2.3; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.beginPath();
    if (kind === 'grapple') {
        cx.arc(0, -10, 2.2, 0, 7);
        cx.moveTo(0, -8); cx.lineTo(0, 2);
        cx.arc(5, 2, 5, Math.PI, Math.PI * 0.15, true);
        cx.stroke();
    } else if (kind === 'weight') {
        cx.arc(0, 3, 7.5, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(0, -4, 5, Math.PI, 0); cx.stroke();
    } else if (kind === 'plinko') { // a bouncy peg: filled circle with bounce arcs
        cx.arc(0, 2, 4.5, 0, 7); cx.fill();
        cx.beginPath(); cx.arc(0, 2, 9, Math.PI * 1.15, Math.PI * 1.85); cx.stroke();
        cx.beginPath(); cx.arc(0, 2, 9, Math.PI * 0.15, Math.PI * 0.85); cx.stroke();
    } else if (kind === 'marionette') { // a puppeteer's control bar (with its handle) and the strings that hang a ball from it
        cx.lineWidth = 1.9;
        cx.moveTo(-8, -9); cx.lineTo(8, -9);
        cx.moveTo(0, -13); cx.lineTo(0, -2);
        cx.moveTo(-5.5, -9); cx.lineTo(-5.5, 1.5);
        cx.moveTo(5.5, -9); cx.lineTo(5.5, 1.5);
        cx.stroke();
        cx.beginPath(); cx.arc(0, 6.5, 5.5, 0, 7); cx.fill();
    } else if (kind === 'decoy') { // a solid ball and a dashed copy of it
        cx.arc(-3, 4, 5.5, 0, 7); cx.fill();
        cx.beginPath(); cx.lineWidth = 2; cx.setLineDash([2.4, 2.4]); cx.arc(4, -3, 6, 0, 7); cx.stroke();
    } else if (kind === 'arrow') { // an arrow pointing up-right
        cx.lineWidth = 2.2;
        cx.moveTo(-7, 7); cx.lineTo(7, -7);
        cx.moveTo(0, -7); cx.lineTo(7, -7); cx.lineTo(7, 0);
        cx.moveTo(-7, 1); cx.lineTo(-7, 7); cx.lineTo(-1, 7);
        cx.stroke();
    } else if (kind === 'bat') { // a bat: knob bottom-left, barrel top-right
        cx.lineWidth = 2.2; cx.moveTo(-8, 8); cx.lineTo(-2.5, 2.5); cx.stroke();
        cx.beginPath(); cx.lineWidth = 6; cx.moveTo(-1, 1); cx.lineTo(7, -7); cx.stroke();
        cx.beginPath(); cx.arc(-8.5, 8.5, 1.7, 0, 7); cx.fill();
    } else if (kind === 'barbwire') { // a strand of wire with two X-shaped barbs
        cx.lineWidth = 2;
        cx.moveTo(-9, 6); cx.lineTo(9, -6);
        cx.stroke();
        cx.beginPath(); cx.lineWidth = 1.8;
        for (const [bx, by] of [[-3.6, 2.4], [3.6, -2.4]]) {
            cx.moveTo(bx - 4, by - 4); cx.lineTo(bx + 4, by + 4);
            cx.moveTo(bx - 4, by + 4); cx.lineTo(bx + 4, by - 4);
        }
        cx.stroke();
    } else if (kind === 'locked') { // padlock
        cx.fillRect(-6, -1, 12, 9);
        cx.beginPath(); cx.arc(0, -2, 4.5, Math.PI, 0); cx.stroke();
    } else { // dash: double chevron
        cx.lineWidth = 2.8;
        cx.moveTo(-9, -7); cx.lineTo(-2, 0); cx.lineTo(-9, 7);
        cx.moveTo(1, -7); cx.lineTo(8, 0); cx.lineTo(1, 7);
        cx.stroke();
    }
    cx.restore();
}
function drawKeyHints() {
    const cfg = [
        { i: 0, p: p1, x: -OX / 2, col: '#42a5f5', name: 'BLUE', dirs: ['', '', '', ''], act: ['X', 'C', 'Z'] },
        { i: 1, p: p2, x: W + OX / 2, col: '#ef5350', name: 'RED', dirs: ['W', 'A', 'S', 'D'], act: ['F', 'G', 'H'] },
    ];
    cx.textAlign = 'center';
    for (const { i: pi, p, x, col, name, dirs, act } of cfg) {
        const k = p.keys;
        cx.font = 'italic 800 18px system-ui, sans-serif';
        cx.fillStyle = col;
        cx.fillText(name, x, 70);
        const KEY = 34, PT = 38; // arrow cluster: up on top, left / down / right below
        const keys = [[0, 105 - 143, 0, k.up, false, dirs[0]], [-PT, 0, -Math.PI / 2, k.l, false, dirs[1]], [0, 0, Math.PI, k.dn, false, dirs[2]], [PT, 0, Math.PI / 2, k.r, false, dirs[3]]];
        for (const [dx, dy, ang, on, dim, letter] of keys) {
            const kx = x + dx, ky = 143 + dy, yy = keyCap(kx, ky, KEY, col, on, dim);
            cx.globalAlpha = dim ? 0.35 : 1;
            arrowGlyph(kx, yy, ang, on ? '#0b0e12' : '#e8e8e4');
            if (letter) {
                cx.font = 'bold 8px system-ui, sans-serif';
                cx.fillStyle = on ? '#0b0e12' : '#98a2ad';
                cx.fillText(letter, kx + 11, yy + 13);
            }
            cx.globalAlpha = 1;
        }
        cx.font = 'bold 8px system-ui, sans-serif';
        cx.fillStyle = '#98a2ad';
        cx.fillText('MOVE / JUMP / DROP', x, 174);
        const sp = SPECIALS.find(a => a.id === p.special) || SPECIALS[0];
        const row = [['grapple', 'GRAPPLE', k.z], ['weight', 'WEIGHT', k.x], [sp.icon, sp.name, k.sp]]; // main inputs; the third is the equipped special
        row.forEach(([kind, label, on], i) => {
            const kx = x + (i - 1) * 46, yy = keyCap(kx, 215, 40, col, on, false);
            cx.globalAlpha = i === 2 && sp.id === 'dash' && !p.dashReady && p.cd.dash <= 0 ? 0.3 : 1; // the dash icon dims while its once-per-trip charge is used up
            iconGlyph(kind, kx, yy - 2, on ? '#0b0e12' : '#e8e8e4');
            cx.globalAlpha = 1;
            const ab = i === 2 ? ABILITY[sp.id] : null, cf = i === 0 ? (p.gCool > 0 ? p.gCool / GRAPPLE_COOLDOWN : 1 - p.gCharge / GRAPPLE_MAX) : ab && ab.cd ? p.cd[sp.id] / ab.cd : 0; // the grapple key tints as its meter is spent, and the whole lockout
            if (cf > 0) { // cooldown: a light gray tint over the icon whose top edge moves downward until the normal icon shows
                cx.save();
                cx.beginPath(); cx.roundRect(kx - 20, yy - 20, 40, 40, 7); cx.clip();
                cx.fillStyle = 'rgba(205,210,220,.65)';
                cx.fillRect(kx - 20, yy - 20 + 40 * (1 - cf), 40, 40 * cf);
                cx.restore();
            }
            cx.font = 'bold 8px system-ui, sans-serif';
            cx.fillStyle = on ? '#0b0e12' : '#98a2ad';
            cx.fillText(act[i], kx + 13, yy + 15);
            cx.fillStyle = '#98a2ad';
            if (!(i === 2 && ui.open === pi)) { // the open menu covers the label
                if (label.length > 8)
                    cx.font = 'bold 6.5px system-ui, sans-serif'; // long names (MARIONETTE) shrink to stay clear of the neighbouring labels
                cx.fillText(label, kx, 251);
                cx.font = 'bold 8px system-ui, sans-serif';
            }
            if (i === 2 && !pickFixed) { // dropdown caret
                const hot = ui.open === pi || (ui.hover && ui.hover.type === 'key' && ui.hover.i === pi);
                cx.fillStyle = hot ? '#fff' : on ? '#0b0e12' : '#98a2ad';
                cx.beginPath(); cx.moveTo(kx + 8, yy - 15); cx.lineTo(kx + 16, yy - 15); cx.lineTo(kx + 12, yy - 10); cx.closePath(); cx.fill();
            }
        });
    }
}
