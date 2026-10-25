// PHYSICS - Fighter: the FIGHTER special. Never draws (see render/fighter.js).
// Adds methods to Player (see mixin() in player.js); load after player.js (and after constants.js, which holds the FIGHTER_* numbers).
// Tuning numbers that apply to every move live in constants.js (FIGHTER_*); the numbers of each individual move live in the FIGHTER_MOVES table below.
//
// HOW IT PLAYS: Fighter takes BOTH special slots (so it only exists when the match uses two specials per player). The two special keys become two attack buttons:
// sp = P (punch), sp2 = K (kick). A plain press is a normal; a motion on the arrow keys just before the press (street-fighter style) is a special move.
//
// MOTIONS are written as numpad digits RELATIVE TO WHERE THE PLAYER FACES (6 = toward the front, 4 = back, 2 = down, 8 = up):
//        7 8 9
//        4 5 6        236 = quarter-circle forward (down, down-forward, forward)      623 = dragon punch (forward, down, down-forward)
//        1 2 3
// The history stores ABSOLUTE directions (6 = screen right) and the recognizer mirrors the motion by p.face when it looks, so turning round mid-motion cannot corrupt it.
//
// LENIENCY (the knobs are FIGHTER_MOTION_T / FIGHTER_LEAD_T in constants.js, and fighterMatch below):
//   - neutral (5) between steps is ignored, so a keyboard player who lets go of every key between two directions still gets the motion;
//   - a diagonal step may be skipped (26 counts as 236, 62 as 623), a straight step may not;
//   - the motion has to be finished within FIGHTER_MOTION_T of leaving its first direction, and within FIGHTER_LEAD_T of the button press.
//
// STATE (all plain data, so saveState / rollback / prediction carry it with no extra work):
//   p.face      1 = facing screen right, -1 = left. Follows the last horizontal key held, and is frozen while a move runs. (Over the network it is blended between snapshots, so read it as p.face >= 0.)
//   p.dirHist   [[direction 1..9, tick], ...] entries, only when the direction changes, oldest first, about FIGHTER_BUFFER_T seconds long
//   p.fTick     this player's own tick counter (counts only while Fighter is equipped)
//   p.move      null, or { id, t, hits }: the move being performed, t = ticks since it started, hits = bit mask of what it has already hit
// A move has three phases, in ticks (120 = 1 s): STARTUP (nothing hurts yet), ACTIVE (the hitbox is live), RECOVERY (committed, nothing hurts). Steering is locked for all of it.

const FIGHTER_MIRROR = [0, 3, 2, 1, 6, 5, 4, 9, 8, 7]; // numpad digit -> its mirror image (left <-> right)
const FIGHTER_DIAG = [1, 3, 7, 9];

// THE ROSTER. One row per move: add a row to add a move, edit numbers to balance it. (No code to touch for a plain hitbox move.)
//   motion    numpad string, or '' for a plain button press (a "normal")
//   button    'sp' (P) or 'sp2' (K)
//   startup / active / recovery   ticks
//   hit       { x, y, r }: the hitbox circle, x = in front of the player's centre (mirrored by facing), y = down from it, r = radius (u)
//   knock     { x, y }: the velocity a hit gives its target (x is mirrored by facing); ballKnock overrides it for the death ball and decoys
//   vx, vy    optional: the fighter's OWN velocity, set the moment the active phase starts (vx is mirrored by facing)
const FIGHTER_MOVES = [
    { id: 'uppercut', name: 'UPPERCUT', motion: '623', button: 'sp', startup: 6, active: 14, recovery: 34, vx: 80, vy: -420, hit: { x: 22, y: -26, r: 28 }, knock: { x: 140, y: -640 }, ballKnock: { x: 200, y: -820 }, stun: { t: 0.55 }, cancel: true },
    { id: 'rush', name: 'RUSH', motion: '46', button: 'sp', startup: 10, active: 16, recovery: 26, vx: 560, hit: { x: 30, y: 0, r: 26 }, knock: { x: 160, y: -40 }, ballKnock: { x: 700, y: -80 }, stun: { t: 0.45 }, cancel: true },
    { id: 'whirlwind', name: 'WHIRLWIND', motion: '698', button: 'sp', startup: 8, active: 20, recovery: 32, sweep: { r: 54, a0: 0, a1: Math.PI, hitR: 24, speed: 720, ballSpeed: 900, steer: true, carry: 1 }, stun: { t: 0.5 }, cancel: true },
    { id: 'fireball', name: 'FIREBALL', motion: '236', button: 'sp2', startup: 14, active: 2, recovery: 34, fire: { x: 36, y: -2, vx: 560, r: 13, life: 2, knock: { x: 160, y: -60 }, ballKnock: { x: 700, y: -40 }, stun: { t: 0.3 } } },
];

function drawFighterInputs() { // debug: the recent directions, as seen from the player's facing (so a fireball reads 2 3 6)
    cx.save();
    cx.font = 'bold 12px ui-monospace, monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.lineWidth = 3; cx.strokeStyle = 'rgba(8,10,16,.85)';
    for (const p of players) {
        if (!p.alive || !p.has('fighter') || !p.dirHist)
            continue;
        const steps = fighterSeq(p.dirHist, p.fTick).slice(-6).map(s => (p.face >= 0 ? s.d : FIGHTER_MIRROR[s.d]));
        if (!steps.length)
            continue;
        const txt = steps.join(' '), y = p.y - p.r - 18;
        cx.strokeText(txt, p.x, y);
        cx.fillStyle = p.color; cx.fillText(txt, p.x, y);
    }
    cx.restore();
}

// ---- fireballs: straight-flying projectiles. They knock what they hit (nothing dies), then vanish. ----
const fireballs = []; // { x, y, vx, vy, r, dir, team, owner, life, knock, ballKnock }
function clearFireballs() { fireballs.length = 0; }
function spawnFireball(p, mv) {
    const fb = mv.fire, f = p.face >= 0 ? 1 : -1, x = p.x + f * fb.x, y = p.y + fb.y;
    if (boomBlocked(x, y, fb.r))
        return; // point blank against a wall: it fizzles
    const mine = fireballs.filter(q => q.owner === p);
    while (mine.length >= FIGHTER_FIREBALL_MAX)
        fireballs.splice(fireballs.indexOf(mine.shift()), 1);
    fireballs.push({ x, y, vx: f * fb.vx, vy: 0, r: fb.r, dir: f, team: p.team, owner: p, life: fb.life, knock: fb.knock, ballKnock: fb.ballKnock || fb.knock, stun: fb.stun });
}
function fireballHit(f) { // true if it was used up
    const targets = [ball, ...decoys.filter(d => !d.dead), ...players.filter(q => q.alive && q !== f.owner && (FIGHTER_HITS_TEAMMATES || q.team !== f.team))];
    for (const b of targets) {
        if (Math.hypot(b.x - f.x, b.y - f.y) >= f.r + b.r)
            continue;
        const kn = b.boost !== undefined ? f.ballKnock : f.knock;
        b.vx = f.dir * kn.x;
        b.vy = kn.y;
        if (b instanceof Player) fighterStun(b, f.stun);
        if (b.boost !== undefined) {
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX)
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        if (f.owner && !f.owner.sim) {
            const sp = Math.hypot(b.vx, b.vy) || 1;
            events.onBatHit(f.owner, b, f.x, f.y, b.vx / sp, b.vy / sp, Math.min(1, sp / 1500));
        }
        return true;
    }
    for (const g of fireballs) // opposing fireballs cancel each other (marked now, removed next tick, so the loop in stepFireballs is not disturbed)
        if (g !== f && g.team !== f.team && Math.hypot(g.x - f.x, g.y - f.y) < g.r + f.r) {
            g.life = 0;
            f.life = 0;
            return false;
        }
    return false;
}
function stepFireballs() { // once per tick, from update()
    for (let i = fireballs.length - 1; i >= 0; i--) {
        const f = fireballs[i];
        f.life -= DT;
        f.x += f.vx * DT;
        f.y += f.vy * DT;
        if (f.life <= 0 || boomBlocked(f.x, f.y, f.r) || fireballHit(f))
            fireballs.splice(i, 1);
    }
}

const FIGHTER_BY_ID = {};
for (const mv of FIGHTER_MOVES)
    FIGHTER_BY_ID[mv.id] = mv;
const FIGHTER_ORDER = [...FIGHTER_MOVES].sort((a, b) => b.motion.length - a.motion.length); // longest motion first, plain presses last: a dragon punch beats the fireball it contains

// ---- reading the keys ----
// The numpad digit for the arrow keys held right now, in ABSOLUTE terms (6 = screen right, 2 = down, 8 = up).
function fighterDir(k) {
    const x = (k.r ? 1 : 0) - (k.l ? 1 : 0), y = (k.dn ? 1 : 0) - (k.up ? 1 : 0); // screen y points down
    return 5 + x - 3 * y;
}
// The history as a list of steps with neutral left out: [{ d, t0, t1 }], t0 = tick the direction began, t1 = tick the next entry began (or `now` if it is still held).
function fighterSeq(hist, now) {
    const out = [];
    for (let i = 0; i < hist.length; i++) {
        const d = hist[i][0];
        if (d === 5)
            continue;
        const t1 = i + 1 < hist.length ? hist[i + 1][1] : now;
        if (out.length && out[out.length - 1].d === d)
            out[out.length - 1].t1 = t1; // the same direction either side of a neutral: one step
        else
            out.push({ d, t0: hist[i][1], t1 });
    }
    return out;
}
// Does the sequence end with this motion (digits, already facing the right way)? Matched backwards from the newest step.
function fighterMatch(seq, motion, now) {
    let i = seq.length - 1, last = null, first = null, used = 0;
    for (let j = motion.length - 1; j >= 0; j--) {
        const m = motion[j];
        if (i >= 0 && seq[i].d === m) {
            if (!last)
                last = seq[i];
            first = seq[i];
            used++;
            i--;
        } else if (!FIGHTER_DIAG.includes(m))
            return false; // a missing diagonal is forgiven, a missing straight step is not
    }
    if (used < 2)
        return false;
    const T = s => Math.round(s / DT);
    return now - last.t1 <= T(FIGHTER_LEAD_T) && now - first.t1 <= T(FIGHTER_MOTION_T);
}
function fighterMotionOk(hist, motion, face, now) { // motion: '236' etc. as seen from a player facing right; face = this player's facing
    const digits = motion.split('').map(c => (face < 0 ? FIGHTER_MIRROR[+c] : +c));
    return fighterMatch(fighterSeq(hist, now), digits, now);
}

// ---- hitboxes ----
function fighterBox(p, hb) { // where a hitbox is right now
    const f = p.face >= 0 ? 1 : -1;
    return { x: p.x + f * hb.x, y: p.y + hb.y, r: hb.r };
}
// One tick of an active hitbox: everything whose circle overlaps it, and was not hit already by this move, is knocked. Hits the death ball, decoys, other players (teammates only if
// FIGHTER_HITS_TEAMMATES) and arrows. Nothing here kills: only the death ball kills.
function fighterSweepDir(p, mv) { // which way the swing opens: the horizontal key held right now, else the way the fighter faces
    const h = (p.keys.r ? 1 : 0) - (p.keys.l ? 1 : 0);
    return mv.sweep.steer && h ? h : (p.face >= 0 ? 1 : -1);
}
function fighterSweep(p, m, mv) {
    const sw = mv.sweep, f = m.dir, s = Math.sign(sw.a1 - sw.a0) || 1; // f was latched when the move started
    const u = Math.max(0, Math.min(1, (m.t - mv.startup + 0.5) / mv.active)), a = sw.a0 + (sw.a1 - sw.a0) * u;
    return { x: p.x + f * sw.r * Math.cos(a), y: p.y - sw.r * Math.sin(a), r: sw.hitR, tx: -f * Math.sin(a) * s, ty: -Math.cos(a) * s };
}
function fighterHits(p, m, mv, ball) {
    const f = p.face >= 0 ? 1 : -1, box = mv.sweep ? fighterSweep(p, m, mv) : fighterBox(p, mv.hit), targets = [ball];
    for (const d of decoys)
        if (!d.dead)
            targets.push(d);
    for (const q of players)
        if (q !== p && q.alive && (FIGHTER_HITS_TEAMMATES || q.team !== p.team))
            targets.push(q);
    for (const a of arrows)
        targets.push(a);
    for (let i = 0; i < targets.length; i++) {
        const b = targets[i], isArrow = b.stuck !== undefined, bit = isArrow ? 0 : 1 << i, seen = !isArrow && (m.hits & bit);
        if (isArrow ? b.immune > 0 : (seen && !mv.sweep))
            continue; // a sweep keeps hold of what is inside it; everything else hits a target once
        const dx = b.x - box.x, dy = b.y - box.y, d = Math.hypot(dx, dy);
        if (d >= box.r + (b.r === undefined ? ARROW_R : b.r))
            continue;
        m.hits |= bit;
        const isBall = b.boost !== undefined;
        let nvx, nvy;
        if (mv.sweep) { // flung along the swing: front -> up -> over -> behind
            const sw = mv.sweep, sp = isBall ? (sw.ballSpeed || sw.speed) : sw.speed, c = sw.carry === undefined ? FIGHTER_CARRY : sw.carry; // c = how much of your own velocity the target takes
            nvx = box.tx * sp + p.vx * c;
            nvy = box.ty * sp + p.vy * c;
        } else {
            const kn = isBall && mv.ballKnock ? mv.ballKnock : mv.knock;
            nvx = f * kn.x + p.vx * FIGHTER_CARRY;
            nvy = kn.y + p.vy * FIGHTER_CARRY;
        }
        if (isArrow)
            arrowKnock(b, nvx, nvy, p.team, p);
        else {
            b.vx = nvx;
            b.vy = nvy;
            if (b instanceof Player)
                fighterStun(b, mv.stun);
        }
        if (ball) {
            const s = Math.hypot(b.vx, b.vy);
            if (s > BALL_VMAX)
                b.boost = Math.max(b.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        if (!p.sim && !seen) { // the effect only fires on the first contact
            const sp = Math.hypot(nvx, nvy) || 1, cd = Math.min(box.r, d);
            events.onBatHit(p, b, box.x + (d > 1 ? dx / d : 0) * cd, box.y + (d > 1 ? dy / d : 0) * cd, nvx / sp, nvy / sp, Math.min(1, sp / 1500));
        }
    }
}

function fighterStun(q, st) { // st = { t } seconds. Awakened players shrug it off.
    if (!st || q.awakeT > 0)
        return;
    q.stunT = Math.max(q.stunT, st.t);
    q.move = null; q.fBuf = null; q.casts.length = 0; q.arrowQueued = false;
    q.rope = null; q.pending = null; q.onBall = false; q.tball = null; q.driveT = 0; q.kickReq = false; q.stretchT = 0;
    q.hopT = 0; q.clinging = false;
}

mixin(Player, {
    // Is a move holding the player? (Player.step zeroes steering while it is.)
    moveLocked() { return this.stunT > 0; },
    // Once per tick BEFORE the key presses are handled (so a press this very tick sees this tick's direction): keep the direction history and the facing.
    fighterRecord() {
        if (!this.has('fighter')) { // swapped away, or one-special mode: forget everything
            if (this.dirHist.length || this.move) {
                this.dirHist = [];
                this.move = null;
            }
            return;
        }
        this.fTick++;
        const d = fighterDir(this.keys), h = this.dirHist, old = this.fTick - Math.round(FIGHTER_BUFFER_T / DT);
        if (!h.length || h[h.length - 1][0] !== d)
            h.push([d, this.fTick]);
        while (h.length > 1 && h[1][1] <= old)
            h.shift(); // (the entry before the window stays, so what was held when the window opened is still known)
        if (!this.move && this.stunT <= 0) { // facing follows the last horizontal key, and stays put while a move is running
            const x = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0);
            if (x)
                this.face = x;
        }
    },
    // A Fighter button went down (called from startAbility, once for 'sp' and once for 'sp2'). Returns true if a move started.
    fighterPress(key, at = this.fTick) {
        if (this.move) {
            const cur = FIGHTER_BY_ID[this.move.id];
            // a normal (no motion) can be cancelled into a special once it is active (and, by default, only if it hit something)
            const cancel = cur && cur.cancel && this.move.t >= cur.startup && (!FIGHTER_CANCEL_NEEDS_HIT || this.move.hits !== 0);
            if (!cancel) {
                this.fBuf = { key, t: this.fTick }; // remember it: it fires when the move ends
                return false;
            }
        }
        if (!this.dirHist.length)
            return false;
        const hist = at === this.fTick ? this.dirHist : this.dirHist.filter(e => e[1] <= at); // a buffered press is judged as of when it was pressed
        for (const mv of FIGHTER_ORDER) {
            if (mv.button !== key)
                continue;
            if (this.move && mv.id === this.move.id) continue; // no cancelling a move into itself
            if (mv.motion && !fighterMotionOk(hist, mv.motion, this.face, at))
                continue;
            this.move = { id: mv.id, t: 0, hits: 0, dir: mv.sweep ? fighterSweepDir(this, mv) : (this.face >= 0 ? 1 : -1) };
            this.fBuf = null;
            if (mv.motion)
                this.dirHist = [this.dirHist[this.dirHist.length - 1]]; // the motion is spent
            return true;
        }
        return false;
    },
    fighterBuffered() { // a move just ended: fire a press that was waiting
        const b = this.fBuf;
        this.fBuf = null;
        if (b && this.fTick - b.t <= Math.round(FIGHTER_BTN_BUFFER_T / DT))
            this.fighterPress(b.key, b.t);
    },
    // Once per tick AFTER the key presses: advance the move that is running.
    fighterStep(ball) {
        const m = this.move;
        if (!m)
            return;
        const mv = FIGHTER_BY_ID[m.id];
        if (!mv) {
            this.move = null;
            return;
        }
        if (m.t === mv.startup) { // the active phase begins: the move's own lunge / hop is ADDED to what you are already doing
            if (mv.vx !== undefined)
                this.vx += (this.face >= 0 ? 1 : -1) * mv.vx;
            if (mv.vy !== undefined)
                this.vy = Math.min(this.vy, 0) + mv.vy; // keeps upward speed you already have, but never adds to a fall
            if (mv.fire && !this.sim)
                spawnFireball(this, mv);
        }
        if ((mv.hit || mv.sweep) && m.t >= mv.startup && m.t < mv.startup + mv.active && !this.sim)
            fighterHits(this, m, mv, ball);
        if (++m.t >= mv.startup + mv.active + mv.recovery) {
            this.move = null;
            this.fighterBuffered();
        }
    },
});
