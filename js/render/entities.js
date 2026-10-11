// RENDER - everything that moves: pegs, abilities in progress, ropes, players, balls, banner. Read-only on game state.
function drawTimer(x, y, rad, frac, col) { // circular timer: faint full track plus an arc of the remaining fraction, starting at 12 o'clock
    cx.lineWidth = 2.5;
    cx.strokeStyle = 'rgba(255,255,255,.18)';
    cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.stroke();
    cx.strokeStyle = col;
    cx.beginPath(); cx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac); cx.stroke();
}
function drawPegs() { // plinko pegs: a spark burst and a pop-in when deployed, a squash / glow / spray of sparks when hit
    const fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453), easeOut = u => 1 - (1 - u) * (1 - u);
    const DEPLOY_T = 0.45; // seconds the deploy effect lasts
    for (const q of pegs) {
        const col = q.team === 0 ? '#42a5f5' : '#ef5350', flicker = q.life < 2 ? 0.45 + 0.4 * Math.sin(q.life * 24) : 1; // flickers while fizzling out
        const age = PEG_LIFE - q.life, du = clamp01(age / DEPLOY_T), deploying = du < 1;
        const hit = (q.hits | 0) > 0 && q.nx !== undefined && q.flash > 0, hu = 1 - q.flash; // hu: 0 right at the hit, 1 when it has faded
        const grow = deploying ? 1 + 2.7 * Math.pow(du - 1, 3) + 1.7 * Math.pow(du - 1, 2) : 1; // pops in from nothing with a little overshoot
        const squash = hit ? 1 + 0.45 * q.flash * q.flash : 1; // swells when hit, then settles
        const rr = (q.r - 1) * grow * squash;
        cx.save();
        cx.globalAlpha = flicker;
        if (hit) { cx.shadowColor = col; cx.shadowBlur = 6 + 22 * q.flash; }
        cx.fillStyle = '#e8e8e4'; cx.strokeStyle = col; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(q.x, q.y, Math.max(0.5, rr), 0, 7); cx.fill(); cx.stroke();
        cx.shadowBlur = 0;
        if (hit) { // the peg lights up in its team colour and fades back
            cx.globalAlpha = flicker * q.flash * 0.85; cx.fillStyle = col;
            cx.beginPath(); cx.arc(q.x, q.y, Math.max(0.5, rr - 1), 0, 7); cx.fill();
        }
        cx.globalAlpha = flicker;
        drawTimer(q.x, q.y, q.r + 5, Math.max(0, q.life) / PEG_LIFE, col);
        cx.restore();

        cx.save();
        cx.globalCompositeOperation = 'lighter';
        cx.lineCap = 'round';
        if (deploying) { // deploy: a ring, a twinkling cross and a ring of sparks flying out of the spot
            const e = easeOut(du), a = 1 - du;
            cx.strokeStyle = col; cx.globalAlpha = 0.9 * a * flicker; cx.lineWidth = 1 + 3 * a;
            cx.beginPath(); cx.arc(q.x, q.y, q.r + 4 + 24 * e, 0, 7); cx.stroke();
            const star = (1 - du) * (q.r + 16); // a 4-point twinkle that shrinks away
            cx.strokeStyle = '#fff'; cx.globalAlpha = 0.95 * a * flicker; cx.lineWidth = 1.5 + 2 * a;
            cx.beginPath();
            line(q.x - star, q.y, q.x + star, q.y);
            line(q.x, q.y - star, q.x, q.y + star);
            cx.stroke();
            for (let i = 0; i < 12; i++) {
                const h = hash(i), h2 = hash(i + 0.5), ang = (i / 12) * Math.PI * 2 + (h - 0.5) * 0.4, ux = Math.cos(ang), uy = Math.sin(ang);
                const reach = 14 + 26 * h2, head = q.r + reach * e, tail = q.r + reach * easeOut(Math.max(0, du - 0.35));
                cx.strokeStyle = i % 2 ? col : '#fff'; cx.globalAlpha = 0.95 * a * flicker; cx.lineWidth = 1 + 2 * h2 * a;
                cx.beginPath(); line(q.x + ux * tail, q.y + uy * tail, q.x + ux * head, q.y + uy * head); cx.stroke();
            }
        }
        if (hit) { // hit: a shock ring and a spray of sparks, mostly toward the side that was hit (where the thing came from)
            const e = easeOut(hu), a = 1 - hu, base = Math.atan2(q.ny, q.nx), seed = (q.hits || 0) * 7;
            cx.strokeStyle = '#fff'; cx.globalAlpha = 0.8 * a * flicker; cx.lineWidth = 1 + 3 * a;
            cx.beginPath(); cx.arc(q.x, q.y, q.r + 3 + 28 * e, 0, 7); cx.stroke();
            for (let i = 0; i < 9; i++) {
                const h = hash(i + seed), h2 = hash(i + seed + 0.5), ang = base + (h - 0.5) * 2.4, ux = Math.cos(ang), uy = Math.sin(ang);
                const reach = 16 + 34 * h2, head = q.r + reach * e, tail = q.r + reach * easeOut(Math.max(0, hu - 0.4));
                cx.strokeStyle = i % 3 ? '#fff' : col; cx.globalAlpha = 0.95 * a * flicker; cx.lineWidth = 1 + 2.2 * h2 * a;
                cx.beginPath(); line(q.x + ux * tail, q.y + uy * tail, q.x + ux * head, q.y + uy * head); cx.stroke();
            }
        }
        cx.restore();
    }
}
function arrowShape(x, y, ang, len, col, alpha) { // a plain rectangle: its leading end at (x, y), trailing back along ang
    cx.save();
    cx.globalAlpha = alpha;
    cx.translate(x, y); cx.rotate(ang);
    cx.fillStyle = col; cx.strokeStyle = '#e8e8e4'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.rect(-len, -ARROW_HALF_W, len, 2 * ARROW_HALF_W); cx.fill(); cx.stroke();
    cx.restore();
}
function arrowStreak(a, col) { // a curved streak behind an arrow in flight, following the real arc (position s seconds ago = pos - v*s + G*s^2/2)
    const sp = Math.hypot(a.vx, a.vy), k = clamp01((sp - 250) / 950); // 0 = slow, 1 = full-charge speed
    if (k <= 0.02)
        return;
    const rgb = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16)), white = rgb.map(v => Math.round(v + (255 - v) * 0.85));
    const N = 12, s0 = ARROW_LEN / sp, span = 0.05 + 0.1 * k, nx = -a.vy / sp, ny = a.vx / sp, pts = []; // the streak starts at the tail of the shaft
    for (let n = 0; n <= N; n++) {
        const s = s0 + span * n / N;
        pts.push({ x: a.x - a.vx * s, y: a.y - a.vy * s + 0.5 * ARROW_G * s * s });
    }
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round';
    for (const off of k > 0.5 ? [0, -1, 1] : [0]) { // thin side lanes at speed, converging toward the tail
        for (let n = 0; n < N; n++) {
            const age = n / N, t = Math.pow(1 - age, 1.3) * k, o = off * ARROW_HALF_W * 1.6 * (1 - age * 0.6), p0 = pts[n], p1 = pts[n + 1];
            const x1 = p0.x + nx * o, y1 = p0.y + ny * o, x2 = p1.x + nx * o, y2 = p1.y + ny * o;
            if (off === 0) { // soft wide glow under the main streak
                cx.strokeStyle = `rgba(${rgb},${0.3 * t})`;
                cx.lineWidth = (8 + 8 * k) * (1 - age * 0.8);
                cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
            }
            const m = k * (1 - age * 0.5), c = rgb.map((v, i) => Math.round(v + (white[i] - v) * m)); // team colour -> white-hot with speed
            cx.strokeStyle = `rgba(${c},${(off === 0 ? 0.85 : 0.5) * t})`;
            cx.lineWidth = (off === 0 ? 1.5 + 2.5 * k : 0.8 + 0.8 * k) * (1 - age * 0.85);
            cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
        }
    }
    cx.restore();
}
function drawArrows() {
    for (const a of arrows) {
        const col = a.team === 0 ? '#42a5f5' : '#ef5350';
        if (!a.stuck && !a.spent)
            arrowStreak(a, col);
        arrowShape(a.x, a.y, a.ang, ARROW_LEN, col, a.stuck ? Math.min(1, a.life / 0.5) : 1);
    }
}
function drawAITags() { // "AI" tag over a computer-controlled player
    if (net.on) // online every seat is a person (the ai flags are offline-only state)
        return;
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
        } else if (p.cast.type === 'bat') { // the bat: purely cosmetic. Held back opposite the aim while charging, then over the top and down through the aim, leaving streaks like the player trails
            const c = p.cast, f = c.charging ? 0 : prog, fade = f > 0.8 ? (1 - f) / 0.2 : 1, r0 = p.r + 3, len = BAT_REACH - r0;
            if (c.charging)
                drawTimer(p.x, p.y, p.r + 6, c.charge, c.charge >= 1 ? '#ffffff' : col);
            cx.save();
            if (f > 0) { // streaks: the bat's recent path, drawn the way trail.js draws a player's (glow under a core line, thinner lanes beside it, all tapering and fading toward the tail)
                const tint = trailTint(p), speed = Math.sin(Math.PI * f), k = clamp01((0.3 + 0.7 * speed) * (0.75 + 0.25 * c.pow)); // brightest mid-swing, a bit more when charged
                const N = 16, span = 0.55, ths = [];
                for (let n = 0; n <= N; n++) { // angles of the bat from now back into the swing
                    const fi = f - span * n / N;
                    if (fi < 0)
                        break;
                    ths.push(batAngleAt(c, fi));
                }
                const lanes = [[0.78, 1], [1, 0], [0.62, 0], [0.9, 0], [0.5, 0], [0.7, 0], [0.38, 0]].slice(0, c.pow > 0.66 ? 7 : c.pow > 0.33 ? 5 : 3); // [share of the reach, is the core lane]
                cx.globalCompositeOperation = 'lighter';
                cx.lineCap = 'round';
                for (const [rf, core] of lanes) {
                    const R = r0 + len * (rf === 1 ? 1 : rf);
                    for (let n = 0; n < ths.length - 1; n++) {
                        const age = n / (ths.length - 1), a = 1 - age, t = Math.pow(a, 1.3) * k * fade;
                        const x1 = p.x + Math.cos(ths[n]) * R, y1 = p.y + Math.sin(ths[n]) * R, x2 = p.x + Math.cos(ths[n + 1]) * R, y2 = p.y + Math.sin(ths[n + 1]) * R;
                        if (core) { // soft wide glow under the main streak
                            cx.strokeStyle = `rgba(${tint.glow},${0.3 * t})`;
                            cx.lineWidth = (10 + 14 * k) * (1 - age * 0.8);
                            cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
                        }
                        const r = tint.from[0] + (tint.to[0] - tint.from[0]) * k, g = tint.from[1] + (tint.to[1] - tint.from[1]) * k, bl = tint.from[2] + (tint.to[2] - tint.from[2]) * k; // team colour -> white-hot
                        cx.strokeStyle = `rgba(${r | 0},${g | 0},${bl | 0},${(core ? 0.9 : 0.6) * t})`;
                        cx.lineWidth = (core ? 2.5 + 6 * k : 1.2 + 1.6 * k) * (1 - age * 0.85);
                        cx.beginPath(); line(x1, y1, x2, y2); cx.stroke();
                    }
                }
                cx.globalCompositeOperation = 'source-over';
            }
            // The bat itself, from the player's edge out to BAT_REACH: a knob, a thin grip wrapped in the team colour, then a barrel that thickens toward a rounded tip.
            const th = batAngleAt(c, f), ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux, at = t => r0 + len * t;
            const hw = t => t < 0.34 ? 1.8 : 1.8 + 3.9 * Math.pow(Math.min(1, (t - 0.34) / 0.52), 0.8); // half-width along the bat
            cx.globalAlpha = fade;
            cx.fillStyle = '#d9a066'; cx.strokeStyle = '#7a4d22'; cx.lineWidth = 1.2; cx.lineJoin = 'round';
            cx.beginPath();
            for (let n = 0; n <= 12; n++) { const t = n / 12, w = hw(t); cx.lineTo(p.x + ux * at(t) + nx * w, p.y + uy * at(t) + ny * w); }
            cx.arc(p.x + ux * at(1), p.y + uy * at(1), hw(1), th - Math.PI / 2, th + Math.PI / 2); // rounded tip
            for (let n = 12; n >= 0; n--) { const t = n / 12, w = hw(t); cx.lineTo(p.x + ux * at(t) - nx * w, p.y + uy * at(t) - ny * w); }
            cx.closePath(); cx.fill(); cx.stroke();
            cx.strokeStyle = col; cx.lineWidth = 3.4; cx.lineCap = 'butt'; // grip tape
            cx.beginPath(); line(p.x + ux * at(0.04), p.y + uy * at(0.04), p.x + ux * at(0.3), p.y + uy * at(0.3)); cx.stroke();
            cx.fillStyle = col; // knob
            cx.beginPath(); cx.arc(p.x + ux * (at(0) - 1), p.y + uy * (at(0) - 1), 3.4, 0, 7); cx.fill();
            cx.restore();
        } else if (p.cast.type === 'arrow') { // charge ring (white and pulsing at full), a drawn bow, and the arrow nocked on it along the aim
            const c = p.cast, full = c.charge >= 1, pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
            drawTimer(p.x, p.y, p.r + 6, c.charge, full ? '#ffffff' : col);
            const ux = Math.cos(c.ang), uy = Math.sin(c.ang), nx = -uy, ny = ux;
            const gd = p.r + 34, len = 12 + 26 * c.charge; // distance of the grip from the player, arrow length (as before)
            const gx = p.x + ux * gd, gy = p.y + uy * gd; // the grip: the bow's middle, the point nearest the target
            const back = 4 + 10 * c.charge, H = 26; // how far the limb tips sit behind the grip (more bend as it charges), and the bow's half-height
            const t1x = gx + nx * H - ux * back, t1y = gy + ny * H - uy * back, t2x = gx - nx * H - ux * back, t2y = gy - ny * H - uy * back;
            const ctx_ = gx + ux * back, cty_ = gy + uy * back; // quadratic control point chosen so the curve passes exactly through the grip
            const hx = gx + ux * 8, hy = gy + uy * 8, tx = hx - ux * len, ty = hy - uy * len; // arrow head (fixed, just past the grip) and its tail = the nock
            cx.save();
            cx.lineCap = 'round'; cx.lineJoin = 'round';
            if (full) { cx.shadowColor = '#ffffff'; cx.shadowBlur = 8 + 6 * pulse; }
            cx.strokeStyle = '#7a4d22'; cx.lineWidth = 5.4; // bow outline, then the wood on top
            cx.beginPath(); cx.moveTo(t1x, t1y); cx.quadraticCurveTo(ctx_, cty_, t2x, t2y); cx.stroke();
            cx.strokeStyle = full ? '#fff0d6' : '#d9a066'; cx.lineWidth = 3.4;
            cx.beginPath(); cx.moveTo(t1x, t1y); cx.quadraticCurveTo(ctx_, cty_, t2x, t2y); cx.stroke();
            cx.shadowBlur = 0;
            cx.strokeStyle = col; cx.lineWidth = 5; // grip wrap in the team colour
            cx.beginPath(); line(gx - nx * 4, gy - ny * 4, gx + nx * 4, gy + ny * 4); cx.stroke();
            cx.strokeStyle = '#e8e8e4'; cx.lineWidth = 1.3; // the string, pulled back to the nock
            cx.beginPath(); cx.moveTo(t1x, t1y); cx.lineTo(tx, ty); cx.lineTo(t2x, t2y); cx.stroke();
            cx.restore();
            arrowShape(hx, hy, c.ang, len, col, full ? 0.7 + 0.3 * pulse : 1);
        } else if (p.cast.type === 'barbwire') { // time left on the wire: a ring that only shows (and only drains) while the rope is out, turning red when nearly spent
            const left = 1 - Math.min(1, p.cast.roped / BARBWIRE_MAX_T);
            if (ropeEnd(p))
                drawTimer(p.x, p.y, p.r + 6, left, left < 0.25 ? '#000000' : col);
            drawTimer(p.x, p.y, p.r + 6, left, left < 0.25 ? '#000000' : col);
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
function drawExplode() { // Explode: a crisp zone of exactly EXPLODE_R (brighter toward the middle, where the blast is strongest), a flash, two shock rings, motion lines bursting out of the blast point, and a streak behind every body that was hit
    const fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453); // a fixed pseudo-random value per line, so the burst looks the same every time without storing anything
    const clamp = v => Math.max(0, Math.min(1, v)), easeOut = u => 1 - (1 - u) * (1 - u);
    cx.save();
    cx.lineCap = 'round';
    for (const p of players) {
        const fx = p.explodeFx;
        if (!fx)
            continue;
        const col = p.team === 0 ? '#42a5f5' : '#ef5350', f = 1 - fx.t / EXPLODE_FX;
        const wave = Math.min(1, f / 0.35), e = easeOut(wave); // the first wave reaches the edge 35% of the way through
        const hold = f < 0.55 ? 1 : 1 - (f - 0.55) / 0.45; // the zone stays fully visible for 55% of the effect, then fades
        // the zone: brightest in the middle (where the push is strongest), faint at the edge
        const zg = cx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, EXPLODE_R);
        zg.addColorStop(0, col + 'aa'); zg.addColorStop(0.5, col + '44'); zg.addColorStop(1, col + '14');
        cx.globalAlpha = hold; cx.fillStyle = zg;
        cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R, 0, 7); cx.fill();
        // a hard white flash at the very start
        if (f < 0.2) {
            const u = f / 0.2;
            cx.globalAlpha = 0.9 * (1 - u); cx.fillStyle = '#fff';
            cx.beginPath(); cx.arc(fx.x, fx.y, p.r + (EXPLODE_R * 0.6) * easeOut(u), 0, 7); cx.fill();
        }
        // wave 1: a bright disc growing to the edge with a coloured front (never past EXPLODE_R)
        if (wave < 1) {
            cx.globalAlpha = 0.45 * (1 - wave); cx.fillStyle = '#fff';
            cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R * e, 0, 7); cx.fill();
            cx.globalAlpha = 1 - 0.6 * wave; cx.strokeStyle = col; cx.lineWidth = 5;
            cx.beginPath(); cx.arc(fx.x, fx.y, Math.max(1, EXPLODE_R * e - 2), 0, 7); cx.stroke();
        }
        // wave 2: a thinner ring that follows and carries on past the edge, fading
        const w2 = clamp((f - 0.1) / 0.6);
        if (w2 > 0 && w2 < 1) {
            cx.globalAlpha = 0.8 * (1 - w2); cx.strokeStyle = '#fff'; cx.lineWidth = 1 + 3 * (1 - w2);
            cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R * (0.5 + 0.9 * easeOut(w2)), 0, 7); cx.stroke();
        }
        // motion lines: streaks that burst out of the blast point, some reaching well past the zone
        cx.save();
        cx.globalCompositeOperation = 'lighter';
        const N = 18, r0 = p.r + 3;
        for (let i = 0; i < N; i++) {
            const h = hash(i), h2 = hash(i + 0.5), ang = (i / N) * Math.PI * 2 + (h - 0.5) * 0.28;
            const delay = 0.12 * h2, u = clamp((f - delay) / 0.7);
            if (u <= 0 || u >= 1)
                continue;
            const reach = EXPLODE_R * (0.9 + 0.9 * h), head = r0 + reach * easeOut(u), tail = r0 + reach * easeOut(Math.max(0, u - 0.4 - 0.2 * h2)); // the tail trails the head, so the line looks like it is shooting outward
            const a = Math.pow(1 - u, 1.2), ux = Math.cos(ang), uy = Math.sin(ang);
            cx.strokeStyle = col; cx.globalAlpha = 0.35 * a; cx.lineWidth = 7 * (1 - u * 0.6); // soft glow under the line
            cx.beginPath(); line(fx.x + ux * tail, fx.y + uy * tail, fx.x + ux * head, fx.y + uy * head); cx.stroke();
            cx.strokeStyle = '#fff'; cx.globalAlpha = 0.95 * a; cx.lineWidth = (1.2 + 2.2 * h2) * (1 - u * 0.7); // hot core
            cx.beginPath(); line(fx.x + ux * tail, fx.y + uy * tail, fx.x + ux * head, fx.y + uy * head); cx.stroke();
        }
        cx.restore();
        // the edge: a solid line whose OUTER side is exactly EXPLODE_R (drawn half a line-width inside it)
        const lw = 3;
        cx.globalAlpha = hold; cx.strokeStyle = '#fff'; cx.lineWidth = lw;
        cx.beginPath(); cx.arc(fx.x, fx.y, EXPLODE_R - lw / 2, 0, 7); cx.stroke();
        // every body that was inside when it went off: a flash ring where it was, and a streak behind it showing which way it was sent (longer = hit harder)
        for (const h of fx.hits || []) {
            cx.globalAlpha = 1 - f; cx.strokeStyle = '#fff'; cx.lineWidth = 3 * (1 - f) + 1;
            cx.beginPath(); cx.arc(h.x, h.y, h.r + 4 + 10 * f, 0, 7); cx.stroke();
            if (h.ux !== undefined) {
                const L = (26 + 90 * h.k) * (0.4 + 0.6 * easeOut(clamp(f / 0.3))) * (1 - f * 0.5);
                cx.strokeStyle = col; cx.globalAlpha = 0.45 * (1 - f); cx.lineWidth = 8 * (1 - f) + 2;
                cx.beginPath(); line(h.x, h.y, h.x - h.ux * L, h.y - h.uy * L); cx.stroke();
                cx.strokeStyle = '#fff'; cx.globalAlpha = 0.9 * (1 - f); cx.lineWidth = 2.5 * (1 - f) + 0.8;
                cx.beginPath(); line(h.x, h.y, h.x - h.ux * L, h.y - h.uy * L); cx.stroke();
            }
        }
    }
    cx.restore();
}
function drawAwakened() { // Awakened: a golden pulsing aura on a powered-up player, with a ring that drains as the time runs out
    const tm = performance.now();
    cx.save();
    for (const p of players) {
        if (!p.alive || !(p.awakeT > 0))
            continue;
        const left = p.awakeT / AWAKENED_T, pulse = 0.5 + 0.5 * Math.sin(tm / 90), fade = left < 0.2 ? 0.5 + 0.5 * Math.sin(tm / 60) : 1; // flickers when nearly spent
        cx.shadowColor = '#ffd35a'; cx.shadowBlur = 16;
        cx.globalAlpha = (0.55 + 0.3 * pulse) * fade; cx.strokeStyle = '#ffd35a'; cx.lineWidth = 2.5;
        cx.beginPath(); cx.arc(p.x, p.y, p.r + 11 + 2 * pulse, 0, 7); cx.stroke();
        cx.shadowBlur = 0; cx.globalAlpha = 1;
        drawTimer(p.x, p.y, p.r + 8, left, '#ffd35a');
    }
    cx.restore();
}
function drawWarps() { // Warp: the marker, the dashed line to it, and the rings left by a teleport (all in the owner's team colour; both teams see both markers)
    const tm = performance.now();
    cx.save();
    cx.lineCap = 'round';
    for (const p of players) {
        const col = p.team === 0 ? '#42a5f5' : '#ef5350', w = p.warp, fx = p.warpFx;
        if (w && p.alive) {
            const ready = p.cd.warp <= 0, pulse = 0.5 + 0.5 * Math.sin(tm / 160);
            cx.strokeStyle = col; cx.lineWidth = 1.6; cx.globalAlpha = ready ? 0.7 : 0.4;
            cx.setLineDash([7, 6]); cx.lineDashOffset = -(tm / 40) % 13; // marching dashes, from you to the spot
            cx.beginPath(); line(p.x, p.y, w.x, w.y); cx.stroke();
            cx.setLineDash([]); cx.lineDashOffset = 0;
            cx.globalAlpha = ready ? 0.65 + 0.35 * pulse : 0.45; cx.lineWidth = 2; // the marker: a dashed ghost of the player with a cross in the middle
            cx.setLineDash([4, 4]);
            cx.beginPath(); cx.arc(w.x, w.y, p.r, 0, 7); cx.stroke();
            cx.setLineDash([]);
            cx.beginPath(); line(w.x - 4, w.y, w.x + 4, w.y); line(w.x, w.y - 4, w.x, w.y + 4); cx.stroke();
            cx.globalAlpha = 1;
            if (!ready) // still cooling down: the ring around the marker fills until the teleport is available
                drawTimer(w.x, w.y, p.r + 5, 1 - p.cd.warp / WARP_COOLDOWN, col);
            else {
                cx.globalAlpha = 0.25 + 0.25 * pulse; cx.strokeStyle = col; cx.lineWidth = 2;
                cx.beginPath(); cx.arc(w.x, w.y, p.r + 5 + 3 * pulse, 0, 7); cx.stroke();
                cx.globalAlpha = 1;
            }
        }
        if (fx) { // departure: the ring collapses where you left. Arrival: reverse ripples shrink in and focus on where you land, then pop
            const f = 1 - fx.t / WARP_FX, easeOut = u => 1 - (1 - u) * (1 - u), fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453);
            cx.strokeStyle = col; cx.lineWidth = 3 * (1 - f) + 1; cx.globalAlpha = (1 - f) * 0.9;
            cx.beginPath(); cx.arc(fx.ax, fx.ay, p.r * (1 - 0.5 * f), 0, 7); cx.stroke();
            cx.save();
            cx.globalCompositeOperation = 'lighter';
            cx.lineCap = 'round';
            const R0 = p.r * 5, R1 = p.r * 0.6;
            for (let i = 0; i < 4; i++) { // staggered ripples, each one smaller than the last as it closes in
                const u = clamp01((f - i * 0.1) / 0.65);
                if (u <= 0 || u >= 1)
                    continue;
                const rad = R0 + (R1 - R0) * Math.pow(u, 1.6); // slow at first, then rushing inward
                cx.strokeStyle = i % 2 ? '#fff' : col; cx.globalAlpha = 0.25 + 0.7 * u; cx.lineWidth = 1 + 4 * u; // brighter and thicker as it focuses
                cx.beginPath(); cx.arc(fx.bx, fx.by, rad, 0, 7); cx.stroke();
            }
            for (let i = 0; i < 12; i++) { // suction lines streaming into the spot
                const h = hash(i), ang = (i / 12) * Math.PI * 2 + (h - 0.5) * 0.3, u = clamp01((f - 0.05 * h) / 0.7);
                if (u <= 0 || u >= 1)
                    continue;
                const head = R0 * 1.1 * (1 - easeOut(u)) + R1, tail = head + (14 + 22 * h) * (1 - u), ux = Math.cos(ang), uy = Math.sin(ang);
                cx.strokeStyle = i % 2 ? col : '#fff'; cx.globalAlpha = 0.9 * (1 - u * 0.5); cx.lineWidth = 1 + 2 * h;
                cx.beginPath(); line(fx.bx + ux * tail, fx.by + uy * tail, fx.bx + ux * head, fx.by + uy * head); cx.stroke();
            }
            const pop = clamp01((f - 0.65) / 0.35); // the focus: a flash and a small ring when the ripples land
            if (pop > 0) {
                cx.fillStyle = '#fff'; cx.globalAlpha = 0.8 * (1 - pop);
                cx.beginPath(); cx.arc(fx.bx, fx.by, p.r * (0.4 + 1.2 * Math.sin(Math.PI * pop)), 0, 7); cx.fill();
                cx.strokeStyle = col; cx.globalAlpha = 0.9 * (1 - pop); cx.lineWidth = 3 * (1 - pop) + 1;
                cx.beginPath(); cx.arc(fx.bx, fx.by, p.r * (1 + 1.2 * easeOut(pop)), 0, 7); cx.stroke();
            }
            cx.restore();
            cx.globalAlpha = 1;
        }
    }
    cx.restore();
}
function anyArrowHeld(p) { return !!(p.keys.l || p.keys.r || p.keys.up || p.keys.dn); }
function drawGrappleRange() { // range indicator when nothing is in reach
    for (const p of players) { // range indicator when nothing is in reach
        if (p.alive && p.keys.z && p.gCool <= 0 && !p.rope && !p.inReach(ball)) {
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
function barbs(x1, y1, x2, y2, col) { // little X-shaped barbs along a lethal rope, one every BARB_GAP u, drifting slowly so it reads as live wire
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    if (d < 4)
        return;
    const ux = dx / d, uy = dy / d, nx = -uy, ny = ux, BARB_GAP = 14, S = 4.5, off = (performance.now() / 60) % BARB_GAP;
    cx.save();
    cx.strokeStyle = col; cx.lineWidth = 1.8; cx.lineCap = 'round';
    cx.beginPath();
    for (let t = off; t < d - 2; t += BARB_GAP) {
        const bx = x1 + ux * t, by = y1 + uy * t;
        cx.moveTo(bx - ux * S + nx * S, by - uy * S + ny * S); cx.lineTo(bx + ux * S - nx * S, by + uy * S - ny * S);
        cx.moveTo(bx - ux * S - nx * S, by - uy * S - ny * S); cx.lineTo(bx + ux * S + nx * S, by + uy * S + ny * S);
    }
    cx.stroke();
    cx.restore();
}
const isBarbed = p => !!(p.cast && p.cast.type === 'barbwire');
function drawRopes() { // hook in flight, then the tether itself (barbed while the owner holds Barbwire)
    for (const p of players) { // hook in flight: the rope reaches out to the target during the landing delay
        if (p.alive && p.pending && p.keys.z) {
            const f = Math.min(1, 1 - p.pending.t / p.pending.t0), ex = p.x + (p.pending.p.x - p.x) * f, ey = p.y + (p.pending.p.y - p.y) * f;
            cx.strokeStyle = isBarbed(p) ? '#e8e8e4' : 'e8e8e4';
            cx.lineWidth = 2;
            cx.beginPath();
            line(p.x, p.y, ex, ey);
            cx.stroke();
            if (isBarbed(p))
                barbs(p.x, p.y, ex, ey, '#e8e8e4');
        }
    }
    for (const p of players) {
        if (p.alive && p.rope) {
            const dd = Math.hypot(p.rope.x - p.x, p.rope.y - p.y);
            // Always draw the tether while it exists (it used to hide while slack, which read as "the grapple didn't draw").
            // A slack floor/slope rope is just drawn fainter than a taut one.
            {
                const slack = !p.onBall && p.ropeGround && dd < p.len - 1, barbed = isBarbed(p);
                if (barbed) { // red glow under the wire
                    cx.save();
                    cx.strokeStyle = '#2d104b'; cx.lineWidth = 7; cx.lineCap = 'round';
                    cx.beginPath(); line(p.x, p.y, p.rope.x, p.rope.y); cx.stroke();
                    cx.restore();
                }
                cx.strokeStyle = barbed ? '#b36bff' : slack ? 'rgba(232,232,228,.45)' : '#e8e8e4';
                cx.lineWidth = 2;
                cx.beginPath();
                line(p.x, p.y, p.rope.x, p.rope.y);
                cx.stroke();
                if (barbed)
                    barbs(p.x, p.y, p.rope.x, p.rope.y, '#000000');
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
function drawDashStreaks() { // dash: after-images, a swarm of blur lines and a shock arc behind the player
    const fr = v => v - Math.floor(v), hash = i => fr(Math.sin(i * 127.1 + 311.7) * 43758.5453);
    const LANES = [-1.15, -0.92, -0.69, -0.46, -0.23, 0, 0.23, 0.46, 0.69, 0.92, 1.15, -2.3, -1.8, 1.8, 2.3]; // across the body (first 11), then loose streaks outside it
    for (const p of players) {
        if (!p.alive || !(p.dashT > 0))
            continue;
        const f = p.dashT / DASH_FX, g = 1 - f, ux = p.dashDir[0], uy = p.dashDir[1], nx = -uy, ny = ux;
        cx.save();
        cx.fillStyle = p.color; // after-images: faded copies of the player strung out behind
        for (let k = 1; k <= 5; k++) {
            const d = k * (8 + 14 * g);
            cx.globalAlpha = 0.3 * f * (1 - k / 6);
            cx.beginPath(); cx.arc(p.x - ux * d, p.y - uy * d, p.r * (1 - 0.06 * k), 0, 7); cx.fill();
        }
        cx.globalCompositeOperation = 'lighter';
        cx.lineCap = 'round';
        cx.strokeStyle = p.color; cx.shadowColor = p.color; cx.shadowBlur = 12;
        const back = Math.atan2(-uy, -ux); // a shock arc behind the player that grows and fades at the start of the dash
        cx.globalAlpha = 0.55 * f * f; cx.lineWidth = 2 + 3 * f;
        cx.beginPath(); cx.arc(p.x, p.y, p.r + 4 + 30 * g, back - 1.1, back + 1.1); cx.stroke();
        LANES.forEach((o, i) => {
            const h = hash(i), h2 = hash(i + 0.5), edge = Math.abs(o), wide = edge > 1.2; // wide = the loose streaks outside the body
            const len = (24 + 120 * f) * (0.45 + 0.9 * h) * (wide ? 0.6 : 1 - 0.3 * edge);
            const sx = p.x + nx * o * p.r + ux * p.r * 0.25 * (h2 - 0.5), sy = p.y + ny * o * p.r + uy * p.r * 0.25 * (h2 - 0.5);
            cx.globalAlpha = (wide ? 0.4 : 0.35 + 0.5 * (1 - edge)) * f;
            cx.lineWidth = wide ? 1.2 : 1.4 + 5 * Math.pow(1 - edge / 1.15, 2);
            cx.beginPath(); line(sx, sy, sx - ux * len, sy - uy * len); cx.stroke();
        });
        cx.restore();
    }
}
function drawPlayerTrails() { // speed lines behind living players (same effect as the death ball's)
    for (const p of players)
        if (p.alive)
            drawTrail(p);
}
function drawGrappleRing(p) {
    const R = p.r + 2;
    if (p.gCool > 0 || p.gCharge < GRAPPLE_MAX - 0.01) {
        const f = p.gCool > 0 ? 1 - p.gCool / GRAPPLE_COOLDOWN : p.gCharge / GRAPPLE_MAX;
        drawTimer(p.x, p.y, R, f, p.gCool > 0 ? '#d25b5b' : f < 0.25 ? '#f0a43c' : '#e8e8e4');
    }
    if (p.gBurst > 0) {
        const u = 1 - p.gBurst / GRAPPLE_BURST_T;
        cx.shadowColor = '#9333ea'; cx.shadowBlur = 14;
        cx.globalAlpha = (1 - u) * 0.9;
        drawTimer(p.x, p.y, R, 1, '#c58bff'); // the ring flashes purple
        for (let i = 0; i < 3; i++) { // three staggered ripples spreading outward
            const v = (u - i * 0.2) / 0.6;
            if (v <= 0 || v >= 1) continue;
            cx.globalAlpha = (1 - v) * 0.85;
            cx.strokeStyle = i === 0 ? '#e0c4ff' : '#b36bff';
            cx.lineWidth = 1 + 4 * (1 - v);
            cx.beginPath(); cx.arc(p.x, p.y, R + (1 - (1 - v) * (1 - v)) * 48, 0, 7); cx.stroke();
        }
        cx.shadowBlur = 0; cx.globalAlpha = 1;
    }
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
        if (p.alive)
            drawGrappleRing(p);
        if (p.alive && p.arrowQueued && !p.cast) { // queued arrow: pulsing dashed ring
            cx.globalAlpha = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 90));
            cx.strokeStyle = p.color; cx.lineWidth = 2; cx.setLineDash([4, 4]);
            cx.beginPath(); cx.arc(p.x, p.y, p.r + 6, 0, 7); cx.stroke();
            cx.setLineDash([]); cx.globalAlpha = 1;
        }
    }
}
function drawBall(b) { // the Death Ball sprite (decoys use it too)
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260); // slow glow pulse
    const bgr = cx.createRadialGradient(b.x - 4, b.y - 4, 1, b.x, b.y, b.r);
    bgr.addColorStop(0, '#000000');
    bgr.addColorStop(1, '#000000');
    cx.fillStyle = bgr;
    cx.strokeStyle = '#b36bff';
    cx.lineWidth = 3;
    cx.shadowColor = '#000000';
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
