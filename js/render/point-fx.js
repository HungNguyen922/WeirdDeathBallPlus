// RENDER - the celebrations: a goal / wipeout burst after every point, and the victory scene when a point wins the match. Display only.
// Everything is a pure function of the simulation's own state (pause, over, msg, score, ball), never the wall clock or Math.random, so every client draws the same frame,
// nothing here needs saving, and it works the same online. No shadowBlur anywhere (it is slow). Called from drawScene() in place of drawMessage().
const fxRand = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }; // a fixed "random" 0..1 for each (i, k)
const fxClamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const fxOutCubic = u => 1 - Math.pow(1 - fxClamp(u), 3);
const fxOutBack = u => { u = fxClamp(u); return 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2); }; // overshoots 1, then settles
const fxRgb = t => (t === 0 ? '66,165,245' : '239,83,80'); // rgb of team t (0 Blue, 1 Red)
const FX_GOLD = '#ffd54a';
let fxAmp = 1; // overall opacity of the effect being drawn (the victory scene fades out at the end)

// The big slanted lettering with a white rim and a dark drop shadow, in a team colour. sc = scale, alpha, tilt in radians.
function fxTitle(txt, x, y, size, rgb, sc, alpha, tilt) {
    cx.save();
    cx.translate(x, y); cx.rotate(tilt); cx.scale(sc, sc);
    cx.globalAlpha = alpha;
    cx.transform(1, 0, -0.2, 1, 0, 0); // italic slant
    cx.font = '900 ' + size + 'px Impact, "Arial Black", system-ui, sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.lineJoin = 'miter'; cx.miterLimit = 8;
    cx.lineWidth = size * 0.17; cx.strokeStyle = '#0b0610'; cx.strokeText(txt, 3, 5);
    cx.lineWidth = size * 0.1; cx.strokeStyle = '#ffffff'; cx.strokeText(txt, 0, 0);
    cx.fillStyle = 'rgb(' + rgb + ')'; cx.fillText(txt, 0, 0);
    const g = cx.createLinearGradient(0, -size / 2, 0, size / 2); // a light top and a dark bottom give it some body
    g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
    cx.fillStyle = g; cx.fillText(txt, 0, 0);
    cx.restore();
}

// Rings spreading out from (x, y): n of them, delay s apart, each lasting dur s and growing to maxR. e = seconds since the first one started.
function fxRings(x, y, e, delay, n, maxR, col, dur) {
    cx.strokeStyle = col;
    for (let k = 0; k < n; k++) {
        const u = (e - k * delay) / dur;
        if (u <= 0 || u >= 1)
            continue;
        cx.globalAlpha = (1 - u) * 0.85 * fxAmp;
        cx.lineWidth = 2 + 9 * (1 - u);
        cx.beginPath(); cx.arc(x, y, 24 + maxR * fxOutCubic(u), 0, 7); cx.stroke();
    }
    cx.globalAlpha = 1;
}

// n sparks flying out of (x, y), each with a fixed direction, speed and lifetime, pulled down by gravity grav. e = seconds since the burst.
// They fly around direction ang within +- spread. seed makes each burst different from the others.
function fxSparks(x, y, e, n, ang, spread, speed, life, grav, cols, seed) {
    cx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
        const a = ang + (fxRand(i, seed) - 0.5) * 2 * spread, sp = speed * (0.45 + 0.55 * fxRand(i, seed + 1)), l = life * (0.6 + 0.4 * fxRand(i, seed + 2)), u = e / l;
        if (u <= 0 || u >= 1)
            continue;
        const px = s => x + Math.cos(a) * sp * s, py = s => y + Math.sin(a) * sp * s + 0.5 * grav * s * s, e0 = Math.max(0, e - 0.05);
        cx.strokeStyle = cols[i % cols.length];
        cx.globalAlpha = (1 - u) * fxAmp;
        cx.lineWidth = 1.5 + 3 * (1 - u);
        cx.beginPath(); cx.moveTo(px(e0), py(e0)); cx.lineTo(px(e), py(e)); cx.stroke();
    }
    cx.globalAlpha = 1;
}

function drawTrophy(col) { // a gold cup about 64 u wide, centred on (0, 0), with a dot of the winner's colour on it
    cx.lineCap = 'round';
    cx.strokeStyle = '#c79a1c'; cx.lineWidth = 5;
    cx.beginPath(); cx.arc(-27, -22, 11, Math.PI * 0.5, Math.PI * 1.5); cx.stroke(); // handles
    cx.beginPath(); cx.arc(27, -22, 11, -Math.PI * 0.5, Math.PI * 0.5); cx.stroke();
    const g = cx.createLinearGradient(-26, 0, 26, 0);
    g.addColorStop(0, '#c79a1c'); g.addColorStop(0.35, '#fff3b0'); g.addColorStop(0.7, FX_GOLD); g.addColorStop(1, '#c79a1c');
    cx.fillStyle = g;
    cx.beginPath(); cx.moveTo(-26, -38); cx.lineTo(26, -38); cx.lineTo(20, -8); cx.quadraticCurveTo(0, 12, -20, -8); cx.closePath(); cx.fill(); // the bowl
    cx.fillRect(-5, 3, 10, 18); // stem
    cx.beginPath(); cx.roundRect(-18, 21, 36, 9, 3); cx.fill(); // base
    cx.fillStyle = col; cx.beginPath(); cx.arc(0, -22, 6, 0, 7); cx.fill();
}

// A point that did not win the match: a flash, rings and sparks from the goal the ball went into (or from the middle after a wipeout), and GOAL! / WIPEOUT!
function drawGoalFx(t, col, e) {
    const wipe = !msg.includes('scores'), gx = ball.x < W / 2 ? 0 : W;
    const ox = wipe ? W / 2 : gx, oy = wipe ? H * 0.45 : fxClamp(ball.y, GOAL_Y0 + 14, GOAL_Y1 - 14);
    cx.save();
    if (e < 0.25) { // the screen flashes the scorer's colour
        cx.globalAlpha = 0.28 * (1 - e / 0.25);
        cx.fillStyle = col;
        cx.fillRect(-OX, 0, CW, H + PIT);
        cx.globalAlpha = 1;
    }
    fxRings(ox, oy, e, 0.09, 3, wipe ? 420 : 300, col, 0.8);
    fxSparks(ox, oy, e, 44, wipe ? 0 : (gx === 0 ? 0 : Math.PI), wipe ? Math.PI : 1.3, 520, 1.0, 420, [col, '#ffffff', FX_GOLD], 1); // out of the goal and into the arena
    const pop = fxOutBack(e / 0.28), fade = fxClamp((POINT_PAUSE - e) / 0.3) * fxClamp(e / 0.06), ty = H * 0.3;
    fxTitle(wipe ? 'WIPEOUT!' : 'GOAL!', W / 2, ty, 112, fxRgb(t), pop, fade, -0.05);
    const su = fxClamp((e - 0.18) / 0.3); // the line under it slides up
    cx.globalAlpha = fade * su;
    cx.font = 'italic 800 30px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
    cx.lineWidth = 6; cx.strokeStyle = '#0b0610'; cx.strokeText(msg.toUpperCase(), W / 2, ty + 78 + (1 - fxOutCubic(su)) * 18);
    cx.fillStyle = '#ffffff'; cx.fillText(msg.toUpperCase(), W / 2, ty + 78 + (1 - fxOutCubic(su)) * 18);
    cx.restore();
}

// The point that wins the match: dim the arena, a sunburst and glow in the winner's colour, fireworks, confetti, a trophy and the winner's name.
function drawWinFx(t, col, e) {
    const rgb = fxRgb(t), inn = fxOutCubic(e / 0.5), out = fxClamp((WIN_PAUSE - e) / 0.4), k = inn * out, mx = W / 2, my = H * 0.42;
    fxAmp = out;
    cx.save();
    cx.fillStyle = 'rgba(6,3,12,' + 0.6 * k + ')'; // dim everything
    cx.fillRect(-OX, 0, CW, H + PIT);
    const N = 16, R = Math.max(W, H) * 1.2, rot = e * 0.3; // the sunburst: wedges that turn slowly
    cx.fillStyle = 'rgba(' + rgb + ',' + 0.17 * k + ')';
    for (let i = 0; i < N; i++) {
        const a = rot + i * (Math.PI * 2 / N), w = Math.PI / N;
        cx.beginPath(); cx.moveTo(mx, my);
        cx.lineTo(mx + Math.cos(a) * R, my + Math.sin(a) * R); cx.lineTo(mx + Math.cos(a + w) * R, my + Math.sin(a + w) * R);
        cx.closePath(); cx.fill();
    }
    const gl = cx.createRadialGradient(mx, my, 0, mx, my, 340 * inn + 1); // a glow behind the words
    gl.addColorStop(0, 'rgba(' + rgb + ',' + 0.5 * k + ')'); gl.addColorStop(1, 'rgba(' + rgb + ',0)');
    cx.fillStyle = gl; cx.fillRect(mx - 360, my - 360, 720, 720);
    fxRings(mx, my, e, 0.16, 3, 520, col, 1.0);
    for (let b = 0; b < 6; b++) { // fireworks, one every half second or so
        const s = 0.3 + b * 0.5 + fxRand(b, 9) * 0.25, bx = W * (0.12 + 0.76 * fxRand(b, 10)), by = H * (0.1 + 0.34 * fxRand(b, 11));
        fxSparks(bx, by, e - s, 28, 0, Math.PI, 260, 1.2, 170, [b % 2 ? col : FX_GOLD, '#ffffff'], 20 + b * 3);
    }
    const cols = [col, '#ffffff', FX_GOLD, t === 0 ? '#90caf9' : '#ef9a9a']; // confetti: starts at different moments, falls and flutters
    for (let i = 0; i < 120; i++) {
        const u = e - fxRand(i, 31) * 1.6;
        if (u <= 0)
            continue;
        const sz = 7 + 7 * fxRand(i, 32), y = -20 + u * (150 + 170 * fxRand(i, 33));
        if (y > H + PIT + 20)
            continue;
        const x = -OX + CW * fxRand(i, 34) + Math.sin(u * (2 + 3 * fxRand(i, 35)) + i) * 34;
        cx.save();
        cx.translate(x, y); cx.rotate(u * (3 + 6 * fxRand(i, 36))); cx.scale(Math.cos(u * (5 + 6 * fxRand(i, 37))), 1);
        cx.globalAlpha = fxAmp; cx.fillStyle = cols[i % cols.length];
        cx.fillRect(-sz / 2, -sz * 0.3, sz, sz * 0.6);
        cx.restore();
    }
    const tp = fxOutBack((e - 0.1) / 0.5); // the trophy bobs above the words
    cx.save();
    cx.translate(mx, H * 0.22 + Math.sin(e * 3) * 3); cx.scale(1.7 * tp, 1.7 * tp); cx.globalAlpha = fxAmp;
    drawTrophy(col);
    cx.restore();
    const ty = H * 0.5;
    fxTitle((t === 0 ? 'BLUE' : 'RED') + ' WINS!', mx, ty, 130, rgb, fxOutBack((e - 0.2) / 0.4), fxAmp * fxClamp((e - 0.2) / 0.08), -0.05);
    const bw = 560 * fxOutCubic((e - 0.45) / 0.4); // an underline wipes in, then the final score
    cx.globalAlpha = fxAmp; cx.fillStyle = col;
    cx.fillRect(mx - bw / 2, ty + 78, bw, 6);
    const su = fxClamp((e - 0.7) / 0.3), txt = 'FINAL  ' + score[t] + ' - ' + score[1 - t];
    cx.globalAlpha = fxAmp * su;
    cx.font = 'italic 800 40px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
    cx.lineWidth = 7; cx.strokeStyle = '#0b0610'; cx.strokeText(txt, mx, ty + 125 + (1 - fxOutCubic(su)) * 16);
    cx.fillStyle = '#ffffff'; cx.fillText(txt, mx, ty + 125 + (1 - fxOutCubic(su)) * 16);
    cx.restore();
    fxAmp = 1;
}

function drawPointFx() { // replaces drawMessage(): runs for as long as the game is paused after a point
    if (!(pause > 0 && msg))
        return;
    const t = msg.startsWith('Blue') ? 0 : 1, col = teamColor(t), e = (over ? WIN_PAUSE : POINT_PAUSE) - pause; // e = seconds since the point
    fxAmp = 1;
    if (over)
        drawWinFx(t, col, e);
    else
        drawGoalFx(t, col, e);
}