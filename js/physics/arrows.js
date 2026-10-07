// PHYSICS - arrows: the ARROW special's aim / charge logic and its projectiles. Never draws.
// Load order: after bodies.js (it reads players, ball and decoys at runtime) and before game/rules.js (which calls stepArrows()).
// Tuning numbers live in constants.js (ARROW_*).
const arrows = []; // in flight or stuck in the terrain: { x, y, vx, vy, ang, team, owner, stuck, life }
const ARROW_SNAP = { l: Math.PI, r: 0, u: -Math.PI / 2, d: Math.PI / 2 }; // angles are screen angles: 0 = right, -PI/2 = up, PI/2 = down, PI = left
const wrapAng = a => Math.atan2(Math.sin(a), Math.cos(a));
// Everything an arrow sticks into. [segment list, extra thickness]: the juts / tunnel ceilings are drawn thick, so they count as thick.
const ARROW_SOLIDS = [[SEGS, 0], [OUTSEGS, 0], [LEDGES, LEDGE_T], [OUTCEIL, LEDGE_T]];

// One physics step of an arrow cast, called from Player.step while the special key is held. c = the cast, k = the player's keys.
// Charge: fills over ARROW_CHARGE_T and then just stays full (that is the cap). Aim: starts pointing up; holding RIGHT turns it clockwise and LEFT
// counter-clockwise, all the way round (so it can point below the player too); tapping any arrow key twice within ARROW_DBL_T snaps it that way at once.
function arrowAimStep(c, k) {
    c.charge = Math.min(1, c.charge + DT / ARROW_CHARGE_T);
    const now = { l: !!k.l, r: !!k.r, u: !!k.up, d: !!k.dn };
    for (const id in now) {
        c.tap[id] = Math.max(0, c.tap[id] - DT);
        if (now[id] && !c.prev[id]) { // a fresh press
            if (c.tap[id] > 0) { // the second tap, in time: snap
                c.ang = ARROW_SNAP[id];
                c.tap[id] = 0;
                c.noTilt = true; // the second tap is still held down: it must not keep turning the arrow
            } else
                c.tap[id] = ARROW_DBL_T;
        }
        c.prev[id] = now[id];
    }
    if (!now.l && !now.r)
        c.noTilt = false;
    if (now.l !== now.r && !c.noTilt) // exactly one of LEFT / RIGHT is held: RIGHT turns the aim clockwise, LEFT counter-clockwise, all the way round (screen y points down, so +angle is clockwise)
        c.ang = wrapAng(c.ang + (now.r ? 1 : -1) * ARROW_TURN * DT);
}

// The key was released: loose the arrow along the aim, at a speed that grows with the charge.
function fireArrow(p, c) {
    const ux = Math.cos(c.ang), uy = Math.sin(c.ang), v = ARROW_V_MIN + (ARROW_V_MAX - ARROW_V_MIN) * c.charge, d = p.r + ARROW_R + 2;
    arrows.push({ x: p.x + ux * d, y: p.y + uy * d, vx: ux * v, vy: uy * v, ang: c.ang, team: p.team, owner: p, stuck: false, life: ARROW_LIFE });
}

function arrowHitsTerrain(a) {
    if (a.y - ARROW_R < 0)
        return true; // ceiling
    if (a.x > 0 && a.x < W && a.y + ARROW_R > H)
        return true; // floor
    for (const [list, t] of ARROW_SOLIDS)
        for (const sg of list) {
            const q = nearestOnSeg(sg, a.x, a.y);
            if (Math.hypot(a.x - q.x, a.y - q.y) < ARROW_R + t)
                return true;
        }
    return false;
}

// An arrow reached a living enemy or a ball. Returns true if it was used up. Teammates and the shooter are passed through.
function arrowStrike(a) {
    for (const p of players)
        if (p.alive && p.team !== a.team && Math.hypot(p.x - a.x, p.y - a.y) < p.r + ARROW_R) {
            if (ARROW_KILLS) {
                p.alive = false;
                p.rope = null;
                p.onBall = false;
            } else {
                p.vx += a.vx * ARROW_KNOCK;
                p.vy += a.vy * ARROW_KNOCK;
            }
            return true;
        }
    for (const b of [ball, ...decoys])
        if (Math.hypot(b.x - a.x, b.y - a.y) < b.r + ARROW_R) { // the death ball (or a decoy) takes a share of the arrow's velocity
            b.vx += a.vx * ARROW_BALL_K;
            b.vy += a.vy * ARROW_BALL_K;
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX) // big hits raise the ball's speed cap briefly, like a hatchet hit
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
            return true;
        }
    return false;
}

function stepArrows() {
    for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i];
        a.life -= DT;
        if (a.life <= 0 || a.x < -OUT_D || a.x > W + OUT_D || a.y > H + PIT) {
            arrows.splice(i, 1); // timed out, or left the world
            continue;
        }
        if (a.stuck)
            continue;
        a.vy += ARROW_G * DT;
        const n = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy) * DT / ARROW_R)); // sub-steps of at most one arrow radius, so a fast arrow cannot skip through a thin wall
        let used = false;
        for (let s = 0; s < n; s++) {
            a.x += a.vx * DT / n;
            a.y += a.vy * DT / n;
            if (arrowStrike(a)) {
                used = true;
                break;
            }
            if (arrowHitsTerrain(a)) {
                a.stuck = true;
                a.vx = a.vy = 0;
                a.life = ARROW_STICK_T;
                break;
            }
        }
        if (used)
            arrows.splice(i, 1);
        else if (!a.stuck)
            a.ang = Math.atan2(a.vy, a.vx); // the arrow nose-dives as gravity bends the flight
    }
}