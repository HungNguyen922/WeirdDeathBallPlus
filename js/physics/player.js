// PHYSICS - Player: movement, grapple rope, and special abilities (dash / plinko / marionette / decoy / arrow / bat / barbwire / warp / awakened).
// step(ball) advances one fixed timestep. Reads this.keys; never draws.
const noKeys = () => ({ l: false, r: false, up: false, z: false, x: false, sp: false, dn: false }); // sp = special ability, dn = down, z = grapple, x = weight
// Bat special. Angle of the bat at swing progress f (0..1). The swing is a semicircle (BAT_ARC) centred on the aim c.ang: it starts BAT_ARC/2 to one side of the aim (pulled back a
// little further the more it is charged), sweeps through the aim and ends BAT_ARC/2 on the other side, easing in and out (smoothstep). Clockwise when aiming right, anticlockwise when
// aiming left. The renderer draws the bat at this angle (and earlier ones for the motion blur); the physics uses the same angle to sweep the hit area.
function batAngleAt(c, f) {
    f = Math.max(0, Math.min(1, f));
    const e = f * f * (3 - 2 * f), s = Math.cos(c.ang) >= 0 ? 1 : -1, half = BAT_ARC / 2, back = half + BAT_WIND * c.charge;
    return c.ang - s * back + s * (back + half) * e;
}
const batAngle = c => batAngleAt(c, c.charging ? 0 : 1 - c.t / c.t0);
// One physics step of a bat swing, called from Player.step while the cast runs. p = the batter, c = the cast, ball = the death ball. c.hits is a bit mask (one bit per target, in
// the order of the list below) of what this swing has already hit: a number, not an array, so the AI's shallow cast copies cannot share it.
// A target is hit when (a) its centre is inside the half-disc, i.e. within BAT_ARC/2 of the aim, and (b) the bat's sweep this step (previous angle -> current angle) passes over it.
// Testing the whole sweep, not just the bat's current angle, means a fast swing can never skip over something.
function batStep(p, c, ball) {
    const f = 1 - c.t / c.t0, th = batAngleAt(c, f), prev = batAngleAt(c, f - DT / c.t0), targets = [ball];
    if (!p.sim) { // the AI's planning copies only know the death ball
        targets.push(...decoys);
        for (const q of players)
            if (q !== p && q.alive && (BAT_HITS_TEAMMATES || q.team !== p.team))
                targets.push(q);
    }
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const ax = Math.cos(c.ang), ay = Math.sin(c.ang); // the way the bat was aimed (the direction held)
    const s = ax >= 0 ? 1 : -1, stepAng = Math.abs(wrap(th - prev)); // s: swing direction, stepAng: how far the bat moved this step
    for (let i = 0; i < targets.length; i++) {
        const b = targets[i], bit = 1 << i;
        if (c.hits & bit)
            continue;
        const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
        if (d > BAT_REACH + b.r)
            continue; // out of reach
        const slack = Math.asin(Math.min(1, b.r / Math.max(d, 1e-6))); // a big target is hit a little earlier / later
        const ang = Math.atan2(dy, dx);
        if (Math.abs(wrap(ang - c.ang)) > BAT_ARC / 2 + slack)
            continue; // outside the semicircle
        const along = s * wrap(ang - prev); // how far past the bat's previous position the target is, measured in the swing direction
        if (along < -slack - BAT_HIT_MARGIN || along > stepAng + slack + BAT_HIT_MARGIN)
            continue; // the bat did not pass it this step
        c.hits |= bit;
        const isPlayer = b instanceof Player, ox = d > 1 ? dx / d : ax, oy = d > 1 ? dy / d : ay; // ox, oy: straight away from the batter
        let ux = ax * BAT_AIM_W + ox * (1 - BAT_AIM_W), uy = ay * BAT_AIM_W + oy * (1 - BAT_AIM_W);
        const m = Math.hypot(ux, uy) || 1;
        ux /= m;
        uy /= m;
        const pow = 1 + BAT_CHARGE_BONUS * c.pow, sp = Math.hypot(b.vx, b.vy); // what it had, plus some; a still target still goes
        const out = isPlayer ? Math.min(BAT_PLAYER_VMAX * pow, (BAT_PLAYER_V + BAT_PLAYER_KEEP * sp) * pow) : Math.min(BAT_VMAX + BAT_VMAX_CHARGE * c.pow, (BAT_V + BAT_KEEP * sp) * pow);
        b.vx = ux * out + p.vx * BAT_CARRY;
        b.vy = uy * out + p.vy * BAT_CARRY;
        if (b.boost !== undefined) { // balls: big hits raise the speed cap briefly, like a hatchet hit
            const sp2 = Math.hypot(b.vx, b.vy);
            if (sp2 > BALL_VMAX)
                b.boost = Math.max(b.boost, Math.min(1, (sp2 - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
        }
        if (b === ball)
            b.pull = { t: BAT_FX, ux, uy, col: p.color }; // streak (only the death ball's timer is stepped in rules.js, so decoys get none)
        if (!p.sim) { // impact effects for the renderer (the AI's planning copies must stay silent): the contact point is on the target's near edge
            const cd = Math.max(p.r, d - b.r);
            events.onBatHit(p, b, p.x + (d > 1 ? dx / d : ax) * cd, p.y + (d > 1 ? dy / d : ay) * cd, ux, uy, Math.min(1, Math.hypot(b.vx, b.vy) / BAT_VMAX));
        }
    }
}
class Player {
    constructor(team, sx, color, id) {
        this.id = id; // 0 Blue, 1 Red, 2 Blue's teammate, 3 Red's teammate (indexes the AI state and key bindings)
        this.team = team;
        this.sx = sx;
        this.color = color;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.r = 16;
        this.ground = false;
        this.alive = true;
        this.rope = null;
        this.pending = null;
        this.onBall = false;
        this.len = 0;
        this.hookAng = 0;
        this.ropeGround = false;
        this.prevX = false;
        this.kickReq = false;
        this.primeT = 0; // seconds of 'primed' left after weight is released (weight held = primed)
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.liftX = this.liftY = 0; this.liftT = 1e9; // the kick still being delivered (see LIFT_RAMP)
        this.tball = null; // the ball (the death ball or a decoy) we are tethered to while onBall
        this.taut = false;
        this.floatW = 1; // grapple-float weight 0..1: dribbling fades it out so the rope can pull you in, then it eases back
        this.dribT = 0;  // seconds left of the 'dribbling' window opened by a weighted kick
        this.sim = false; // true on the AI planner's throwaway copies: they must not touch the real game (spawn decoys / pegs)
        this.keys = noKeys();
        this.special = 'dash'; // chosen special ability (see SPECIALS)
        this.warp = null; // Warp: the placed marker { x, y }, or null (replaced, never edited in place, so the AI's shallow copies are safe)
        this.awakeT = 0; // Awakened: seconds of power-up left (0 = not awake)
        this.warpFx = null; // Warp: the last teleport { t, ax, ay, bx, by } (a short visual: rings at both ends); t counts down from WARP_FX
        this.arrowAng = -Math.PI / 2; // last arrow aim, kept across rounds (so not in reset())
        this.reset();
    }
    reset() {
        this.x = this.sx;
        this.y = H - this.r;
        this.vx = this.vy = 0;
        this.alive = true;
        this.rope = null;
        this.pending = null;
        this.awakeT = 0; // Awakened never survives the round (cleared before the meter below, so it starts at the normal size)
        this.gCharge = this.grapMax; // grapple meter: seconds of grip left
        this.gCool = 0;             // > 0: the meter was spent; no grappling at all until this runs out (then the meter restarts from 0 and refills passively)
        this.onBall = false;
        this.ground = false;
        this.ropeBase = null;
        this.netSide = undefined; // which side of the net we were last on (0 left, 1 right); set after the first step
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.liftX = this.liftY = 0; this.liftT = 1e9; // the kick still being delivered (see LIFT_RAMP)
        this.dashReady = true; // one dash per trip off the floor
        this.tball = null;
        this.cd = { dash: 0, plinko: 0, marionette: 0, decoy: 0, arrow: 0, bat: 0, barbwire: 0, warp: 0, awakened: 0 }; // per-ability cooldown remaining (s)
        this.warp = null; // a marker never survives the round
        this.warpFx = null;
        for (const id in ABILITY)
            this.cd[id] = ABILITY[id].cd * START_CD;
        this.cast = null; // ability being cast: { type, t, t0, hx, hy, x, y }
        this.dashT = 0;
        this.dashDir = [0, 0];
        this.prevSp = false;
        this.arrowQueued = false;
        this.gBurst = 0;
    }
    get grounded() { return this.ground; }
    // Awakened (active for AWAKENED_T s): per-player versions of the grapple / kick / crash numbers. Everyone else gets the plain constants.
    get grapMax() { return GRAPPLE_MAX * (this.awakeT > 0 ? AWAKENED.use : 1); } // seconds of grapple use
    get range() { return RANGE * (this.awakeT > 0 ? AWAKENED.range : 1); } // grapple reach
    get grapLock() { return GRAPPLE_COOLDOWN * (this.awakeT > 0 ? AWAKENED.lock : 1); } // overcharge lockout (s)
    get kickV() { return this.awakeT > 0 ? AWAKENED.kick : 1; } // weighted kick strength
    get crashK() { return this.awakeT > 0 ? AWAKENED.crash : 1; } // share of a crash shot's push on the ball
    // Overcharge: the meter is emptied, the grapple is locked out for GRAPPLE_COOLDOWN and the grip is torn away (purple ripple). Happens when the meter runs out, or when a
    // player with their grapple active (rope out, or hook in flight) touches an enemy (see update() in rules.js).
    overcharge() {
        this.gCharge = 0;
        this.gCool = this.grapLock;
        this.gBurst = GRAPPLE_BURST_T;
        this.kickReq = false;
        this.rope = null;
        this.pending = null;
        this.onBall = false;
        this.tball = null;
    }
    // Everything grappleable within RANGE: surfaces (ground = floor/slopes) and the ball.
    candidates(ball) {
        const c = [];
        const add = (p, ground) => {
            const d = Math.hypot(p.x - this.x, p.y - this.y);
            c.push({ p, d, len: Math.max(d, MIN_LEN), b: false, ground });
        };
        const o = sawY(this.x); // the floor can be raised by a quake: look it up in the floor's own frame, then lift the result
        add({ x: this.x, y: H + o }, true);
        for (const p of [{ x: this.x, y: 0 }, { x: 0, y: this.y }, { x: W, y: this.y }])
            add(p, false);
        add(nearestOnSeg(NETSEGS[0], this.x, this.y), false); // the net only exists below its gap
        for (const sg of SEGS) {
            const q = nearestOnSeg(sg, this.x, this.y - o);
            add({ x: q.x, y: q.y + sawY(q.x) }, true);
        }
        for (const sg of LEDGES)
            add(nearestOnSeg(sg, this.x, this.y), false);
        for (const b of this.sim ? [ball] : [ball, ...decoys]) { // the death ball and any decoys (the AI's planning copies only know the death ball)
            const ang = Math.atan2(this.y - b.y, this.x - b.x); // grapple point on the ball's edge, facing us
            const hp = { x: b.x + Math.cos(ang) * b.r, y: b.y + Math.sin(ang) * b.r };
            const hd = Math.hypot(hp.x - this.x, hp.y - this.y);
            c.push({ p: hp, d: hd, len: Math.max(hd, 41), b: true, ground: false, ball: b, decoy: b !== ball });
        }
        const reach = this.range;
        return c.filter(o => o.d <= reach);
    }
    inReach(ball) { return this.candidates(ball).length > 0; }
    // Tether to the nearest thing in reach (no priorities). Rope length = distance at press.
    attach(ball) {
        const best = this.candidates(ball).reduce((m, o) => (!m || o.d < m.d ? o : m), null);
        if (!best)
            return;
        if (best.b) { // ball: instant; the pivot sits on the ball's edge and spins with it
            this.rope = best.p;
            this.len = best.len;
            this.onBall = true;
            this.tball = best.ball;
            this.ropeGround = false;
            this.ropeBase = null;
            this.hookAng = Math.atan2(best.p.y - best.ball.y, best.p.x - best.ball.x) - best.ball.th;
            return;
        }
        const delay = this.grounded ? GROUND_DELAY : HOOK_DELAY; // the hook takes a moment to land
        if (delay > 0) {
            this.pending = { p: best.p, t: delay, t0: delay, ground: best.ground };
            return;
        }
        this.land(best.p, best.ground);
    }
    // The hook lands on a surface: tether length = distance right now. A grapple jump (rising on floor/slopes) kicks the player
    // directly away from the pivot (weight multiplies it), with matching tether slack; a pivot behind you gives a diagonal hop.
    land(p, ground) {
        const dx = this.x - p.x, dy = this.y - p.y, d = Math.hypot(dx, dy);
        this.rope = p;
        this.onBall = false;
        this.ropeGround = ground;
        this.ropeBase = ground ? { x: p.x, y: p.y - sawY(p.x) } : null; // floor pivots ride the floor when it pops
        this.len = Math.max(d, MIN_LEN);
        this.taut = false;
        if (ground && this.vy <= 0) {
            const chain = Math.min(GJ_MAX, GJ_START * Math.pow(GJ_GROWTH, this.gjN)); // exponential ramp over a spammed chain
            const lift = LIFT_V * chain * (this.keys.x ? WEIGHT_M : 1);
            this.gjN++;
            this.gjT = 0;
            let ux = d > 1 ? dx / d : 0, uy = d > 1 ? dy / d : -1;
            ux *= HOP_AIM;
            const m = Math.hypot(ux, uy) || 1;
            ux /= m;
            uy /= m; // mostly up/away, less sideways
            this.liftX = ux * lift; // delivered over LIFT_RAMP by step(), not added all at once
            this.liftY = uy * lift;
            this.liftT = 0;
            this.len += lift * (this.keys.x ? LIFT_SLACK_W : LIFT_SLACK); // extra rope from the kick (less when weighted)
            this.taut = false;
        }
    }
    // Something just appeared at (x, y) with radius rr: if we overlap it we are moved out along the arrow(s) held when the cast began (c.hx / c.hy); with none held: up if
    // we are on the floor, otherwise back against our motion. We keep the speed that was carrying us away from it and lose the part that carried us into it.
    pushOutOf(x, y, rr, c) {
        if (Math.hypot(this.x - x, this.y - y) >= this.r + rr)
            return;
        const sp = Math.hypot(this.vx, this.vy);
        let ux = 0, uy = -1;
        if (!this.ground && sp > 30) { ux = -this.vx / sp; uy = -this.vy / sp; }
        if (c.hx || c.hy) { const m = Math.hypot(c.hx, c.hy); ux = c.hx / m; uy = c.hy / m; }
        this.x = x + ux * (this.r + rr + 1);
        this.y = y + uy * (this.r + rr + 1);
        const vn = this.vx * -ux + this.vy * -uy;
        if (vn > 0) { this.vx -= -ux * vn; this.vy -= -uy * vn; }
        this.vx += ux * 60;
        this.vy += uy * 60;
    }
    // Awakened on / off. The grapple meter keeps its share (a full meter stays full). Wearing off starts the cooldown; being swapped away from (cooling = false) does not.
    setAwake(on, cooling = true) {
        if (on) {
            this.gCharge *= AWAKENED.use;
            this.awakeT = AWAKENED_T;
        } else { // (only called while awake: see step)
            this.gCharge /= AWAKENED.use;
            this.awakeT = 0;
            if (cooling)
                this.cd.awakened = AWAKENED_COOLDOWN;
        }
    }
    // Warp key press. No marker yet: drop one here. A marker and the cooldown is over: jump to it. Position only: vx / vy are untouched, so all momentum carries over.
    // The grapple is kept: the rope stays on its pivot (or ball) and the normal tether rules take over from the new spot. netSide is refreshed so the net guard in step() does not drag us back across the net.
    warpPress() {
        if (!this.warp) {
            this.warp = { x: this.x, y: this.y };
            return;
        }
        if (this.cd.warp > 0)
            return;
        this.warpFx = { t: WARP_FX, ax: this.x, ay: this.y, bx: this.warp.x, by: this.warp.y };
        this.x = this.warp.x;
        this.y = this.warp.y;
        this.warp = null;
        this.cd.warp = WARP_COOLDOWN;
        this.netSide = this.x < NETX ? 0 : 1;
    }
    step(ball) {
        const k = this.keys, heavy = k.x;
        this.gjT += DT;
        this.dribT = Math.max(0, this.dribT - DT);
        if (this.gjT > GJ_CHAIN_T)
            this.gjN = 0; // chain broken
        const ramp = Math.max(LIFT_RAMP, DT);
        if (this.liftT < ramp) { // ease the grapple-jump kick in
            const s = u => u * u * (3 - 2 * u), f = s(Math.min(1, (this.liftT + DT) / ramp)) - s(this.liftT / ramp);
            this.vx += this.liftX * f;
            this.vy += this.liftY * f;
            this.liftT += DT;
        }
        const dir = this.cast && this.cast.type === 'arrow' ? 0 : (k.r ? 1 : 0) - (k.l ? 1 : 0);
        // Constant acceleration toward the max speed (the demo shows a steady ramp, not a hard build-up curve).
        const acc = RUN_ACC * (this.grounded ? 1 : 0.55) * (dir * this.vx < 0 ? 1.4 : 1);
        if (dir && dir * this.vx < 330)
            this.vx += dir * acc * DT;
        else if (!dir && this.grounded && !this.rope)
            this.vx *= 1 - GROUND_BRAKE * DT; // no ground braking while tethered, so the rope bounce is not eaten
        // Dash: the special key gives an impulse in the arrow direction(s) held. One use, refilled whenever the player is on the floor.
        if (this.ground)
            this.dashReady = true;
        for (const id in this.cd)
            this.cd[id] = Math.max(0, this.cd[id] - DT);
        this.dashT = Math.max(0, this.dashT - DT);
        if (this.special !== 'warp')
            this.warp = null; // swapped to another special: the marker goes with it
        if (this.awakeT > 0) {
            if (this.special !== 'awakened')
                this.setAwake(false, false); // swapped to another special: the power-up ends, no cooldown
            else if ((this.awakeT -= DT) <= 0)
                this.setAwake(false); // wore off: the cooldown starts now
        }
        if (this.warpFx && (this.warpFx = { ...this.warpFx, t: this.warpFx.t - DT }).t <= 0)
            this.warpFx = null;
        this.gBurst = Math.max(0, this.gBurst - DT);
        // Start a cast. The arrow(s) held at the press are remembered (dash direction / plinko displacement); plinko also remembers the spot.
        if (this.special === 'arrow' && k.sp && this.cd.arrow > 0)
            this.arrowQueued = true; // held during cooldown: queue the next cast
        if (!k.sp)
            this.arrowQueued = false;
        if (!this.cast && ((k.sp && !this.prevSp) || (this.arrowQueued && this.special === 'arrow' && this.cd.arrow <= 0))) {
            this.arrowQueued = false;
            const hx = (k.r ? 1 : 0) - (k.l ? 1 : 0), hy = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
            if (this.special === 'dash' && this.dashReady && this.cd.dash <= 0 && (hx || hy) && !(this.ground && !hx && hy > 0)) // pushing straight down into the floor does not use it up
                this.cast = { type: 'dash', t: DASH_CAST, t0: DASH_CAST, hx, hy };
            else if (this.special === 'plinko' && this.cd.plinko <= 0)
                this.cast = { type: 'plinko', t: PLINKO_CAST, t0: PLINKO_CAST, hx, hy, x: this.x, y: this.y };
            else if (this.special === 'marionette' && this.cd.marionette <= 0) // starts aiming: no timer, it lasts as long as the key is held
                this.cast = { type: 'marionette', aim: true, t: 1, t0: 1, hx, hy, grace: hx || hy ? MARIONETTE_GRACE : 0 };
            else if (this.special === 'decoy' && this.cd.decoy <= 0)
                this.cast = { type: 'decoy', t: DECOY_CAST, t0: DECOY_CAST, hx, hy, x: this.x, y: this.y }; // remembers the spot (and the arrows) at the press, like plinko
            else if (this.special === 'bat' && this.cd.bat <= 0) // charges while the key is held (aim read live), swings on release
                this.cast = { type: 'bat', t: BAT_T, t0: BAT_T, charging: true, charge: 0, pow: 0, hx, hy, ang: hx || hy ? Math.atan2(hy, hx) : Math.atan2(ball.y - this.y, ball.x - this.x), hits: 0 };
            else if (this.special === 'barbwire' && this.cd.barbwire <= 0) // the rope is lethal while the special and grapple key is held (see barbedRopeKills in rules.js); letting go or running out of time ends it
                this.cast = { type: 'barbwire', t: 1, t0: 1, held: 0, roped: 0, hx, hy };
            else if (this.special === 'awakened') { // instant, no cast: power up if ready and not already awake
                if (this.cd.awakened <= 0 && this.awakeT <= 0)
                    this.setAwake(true);
            } else if (this.special === 'warp') // instant: no cast, no timer (see warpPress)
                this.warpPress();
            else if (this.special === 'arrow' && this.cd.arrow <= 0)
                this.cast = { type: 'arrow', t: 1, t0: 1, charge: 0, ang: this.arrowAng, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: k.l, r: k.r, u: k.up, d: k.dn } };

        }
        if (this.cast) {
            const c = this.cast;
            if (c.type === 'arrow') {
                arrowAimStep(c, k);
                this.arrowAng = c.ang;
                if (!k.sp)
                    c.t = 0; // released: fire (below)
            } else if (c.aim) { // marionette: follow the arrows while the key is held; letting go fires (or cancels if there is no direction)
                const ax = (k.r ? 1 : 0) - (k.l ? 1 : 0), ay = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
                if (ax || ay) {
                    c.hx = ax;
                    c.hy = ay;
                    c.grace = MARIONETTE_GRACE;
                } else
                    c.grace = Math.max(0, c.grace - DT);
                if (!k.sp) {
                    if ((c.hx || c.hy) && c.grace > 0)
                        c.t = 0; // released with a direction: fire (below)
                    else
                        this.cast = null; // released with none: cancelled, nothing spent
                }
            } else if (c.type === 'barbwire') {
                c.held += DT;
                if (this.rope || (this.pending && k.z))
                    c.roped += DT; // time the wire was really out (hook in flight or tethered): only this costs cooldown
                if (!k.sp || c.roped >= BARBWIRE_MAX_T)
                    c.t = 0;
            } else if (c.type === 'bat') {
                if (c.charging) { // holding the key: charge up and follow the arrows; the timer does not run yet
                    const ax = (k.r ? 1 : 0) - (k.l ? 1 : 0), ay = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
                    if (ax || ay) {
                        c.hx = ax;
                        c.hy = ay;
                    }
                    c.ang = c.hx || c.hy ? Math.atan2(c.hy, c.hx) : Math.atan2(ball.y - this.y, ball.x - this.x); // last direction held, or the death ball if none ever was
                    c.charge = Math.min(1, c.charge + DT / BAT_CHARGE_T);
                    if (!k.sp) { // released: swing
                        c.charging = false;
                        c.pow = c.charge;
                    }
                } else {
                    batStep(this, c, ball);
                    c.t -= DT;
                }
            } else
                c.t -= DT;
            if (this.cast && c.t <= 0) {
                this.cast = null;
                if (c.type === 'dash' && this.dashReady) {
                    const m = Math.hypot(c.hx, c.hy), ux = c.hx / m, uy = c.hy / m;
                    if (ux && this.vx * ux < 0)
                        this.vx = 0; // cancel what we were doing against the dash
                    if (uy && this.vy * uy < 0)
                        this.vy = 0;
                    this.vx += ux * DASH_V;
                    this.vy += uy * DASH_V;
                    this.dashReady = false;
                    this.cd.dash = DASH_COOLDOWN;
                    this.dashT = DASH_FX;
                    this.dashDir = [ux, uy];
                } else if (c.type === 'plinko') {
                    // The peg appears at the spot where the cast began. If we are still overlapping it we get pushed out in the direction of the arrow(s)
                    // held at the press; with none held: up if we are on the floor, otherwise back against our motion.
                    const peg = { x: c.x, y: c.y, vx: 0, vy: 0, r: PEG_R, team: this.team, owner: this, flash: 1, life: PEG_LIFE };
                    if (!this.sim) { // (the AI's planning copies must not leave pegs in the real game)
                        pegs.push(peg);
                        if (pegs.filter(q => q.owner === this).length > PEG_MAX)
                            pegs.splice(pegs.findIndex(q => q.owner === this), 1);
                    }
                    this.pushOutOf(peg.x, peg.y, PEG_R, c);
                    this.cd.plinko = PLINKO_COOLDOWN;
                } else if (c.type === 'marionette') {
                    // An impulse on the death ball along the arrow(s) held when the key was released. Motion against the shove is cancelled first, so it always goes the way you pointed.
                    const m = Math.hypot(c.hx, c.hy), ux = c.hx / m, uy = c.hy / m;
                    if (ux && ball.vx * ux < 0)
                        ball.vx = 0;
                    if (uy && ball.vy * uy < 0)
                        ball.vy = 0;
                    ball.vx += ux * MARIONETTE_V;
                    ball.vy += uy * MARIONETTE_V;
                    ball.pull = { t: MARIONETTE_FX, ux, uy, col: this.color };
                    this.cd.marionette = MARIONETTE_COOLDOWN;
                } else if (c.type === 'decoy') {
                    // The lookalike appears where the cast began (replacing this team's previous one). If we are still standing in it we are pushed out the way the
                    // arrow(s) pointed at the press, exactly like plinko.
                    if (!this.sim)
                        spawnDecoy(this, c.x, c.y);
                    this.pushOutOf(c.x, c.y, BALL_R, c);
                    this.cd.decoy = DECOY_COOLDOWN;
                } else if (c.type === 'arrow') {
                    if (!this.sim)
                        fireArrow(this, c);
                    this.cd.arrow = ARROW_COOLDOWN;
                } else if (c.type === 'barbwire') {
                    this.cd.barbwire = Math.min(c.roped, BARBWIRE_MAX_T) * BARBWIRE_CD_RATIO; // proportional to how long the wire was out
                } else if (c.type === 'bat') {
                    this.cd.bat = BAT_COOLDOWN; // the cooldown starts when the swing ends
                }
            }
        }
        this.prevSp = k.sp;
        // Jump: pressing UP on the ground launches at JUMP_V. While UP stays held in the air, gravity drops to G_FLOAT, which
        // gives the long, symmetric float seen in the demo; releasing UP restores full gravity G. While tethered and
        // holding UP, a floaty arc keeps swings and floats working.
        if (k.up && this.grounded)
            this.vy = -JUMP_V;
        let g = (k.up ? G_FLOAT : G) * (heavy ? 1.35 : 1);
        if (k.up && this.rope) {
            g = (this.onBall ? G * 0.4 : G_FLOAT) * (heavy ? 1.35 : 1);
            const cap = this.onBall ? 170 : 70;
            if (this.onBall) {
                if (this.vy > cap)
                    this.vy = cap;
            } else if (this.vy > cap)
                g = 0; // surface tether: the float only stops gravity from adding fall speed. It never clips the rope's own recoil, so a held grapple can pull you back through the pivot
        }
        if (k.dn)
            g = G * DOWN_G * (heavy ? 1.35 : 1); // DOWN: drop faster (also cancels the UP float), which keeps dribbles low
        // Weight primes the kick: while it is held (and for PRIME_T s after it is released) any grapple that lands applies the kick at once,
        // and the kick is re-armed whenever there is no rope, so a primed player can grapple, kick, let go and grapple again.
        if (k.x)
            this.primeT = PRIME_T;
        else
            this.primeT = Math.max(0, this.primeT - DT);
        const primed = k.x || this.primeT > 0;
        if ((k.x && !this.prevX) || (primed && !this.rope && !this.pending))
            this.kickReq = true; // remembered until the hook lands, so a delayed hook still gets its kick
        // Grapple meter: GRAPPLE_MAX seconds of use (rope out, or hook in flight). Spend it all and the grapple is locked out for GRAPPLE_COOLDOWN seconds,
        // then comes back full. Letting go at any point refills it over time instead.
        this.gCharge = Math.min(this.gCharge, this.grapMax); // (safety net: the meter can never exceed the current maximum)
        if (this.gCool > 0) {
            this.gCool = Math.max(0, this.gCool - DT);
            if (this.gCool === 0)
                this.gCharge = 0; // lockout over: the meter does NOT jump to full, it restarts from 0 (grapple again right away and it just overcharges again)
        }
        const z = k.z && this.gCool <= 0;
        if (!z && !primed)
            this.kickReq = false; // a primed kick survives the grapple being up
        if (z && !this.rope && !this.pending)
            this.attach(ball); // also latches on when you drift into reach while holding
        if (this.pending && z) {
            this.pending.t -= DT;
            if (this.pending.t <= 0) {
                const h = this.pending;
                this.pending = null;
                this.land(h.p, h.ground);
            }
        }
        if (this.rope || this.pending) {
            this.gCharge -= DT;
            if (this.gCharge <= 0) // spent: the grip is torn away
                this.overcharge();
        } else if (this.gCool <= 0)
            this.gCharge = Math.min(this.grapMax, this.gCharge + GRAPPLE_REGEN * DT);
        if (!z) {
            this.rope = null;
            this.pending = null;
            this.onBall = false;
            this.tball = null;
        }
        // Tether = a leash: a maximum length, nothing more. Stretched past it = spring + damping (hard limit on surfaces); closer than it the rope is slack. The pivot
        // has no effect on you at all: no push, no steering, nothing solid, so you can swing right through it. The ball pivot sits on its edge and spins with it.
        const a = this.rope, tb = this.tball || ball; // tb = the ball we are tethered to: the death ball or one of the decoys
        if (a) {
            if (this.ropeBase && !this.onBall)
                a.y = this.ropeBase.y + sawY(a.x);
            if (this.onBall) {
                const ang = tb.th + this.hookAng;
                a.x = tb.x + Math.cos(ang) * tb.r;
                a.y = tb.y + Math.sin(ang) * tb.r;
            }
            const dx = a.x - this.x, dy = a.y - this.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
            const rx = a.x - tb.x, ry = a.y - tb.y; // hook offset from the ball's center
            const hvx = this.onBall ? tb.vx - tb.w * ry : 0, hvy = this.onBall ? tb.vy + tb.w * rx : 0;
            const closing = (this.vx - hvx) * nx + (this.vy - hvy) * ny;
            if (this.ropeGround && !this.onBall && Math.abs(this.x - a.x) > 12)
                this.pivotSide = Math.sign(this.x - a.x); // which side of the pivot you were last on
            if (this.kickReq && !this.onBall) {
                this.vx -= nx * WEIGHT_KICK * this.kickV;
                this.vy -= ny * WEIGHT_KICK * this.kickV;
                this.kickReq = false;
                if (this.ropeGround)
                    this.dribT = DRIB_T; // weighted kick on a floor pivot = dribbling: the float steps aside
            }
            if (d > this.len) {
                if (this.onBall) {
                    // Rope = distance constraint on the ball: cancel only the speed that would stretch it (mass-weighted, so the
                    // light ball takes the correction). Tangential speed survives, so the ball keeps circling the player.
                    const c = rx * ny - ry * nx, im = 1 + 1 / BALL_TM + c * c / BALL_I;
                    if (closing < 0) {
                        const J = -closing * BALL_RIGID / im;
                        this.vx += nx * J * BALL_PULL;
                        this.vy += ny * J * BALL_PULL;
                        tb.vx -= nx * J / BALL_TM;
                        tb.vy -= ny * J / BALL_TM;
                        tb.w -= J * c / BALL_I;
                    }
                }
                const x = d - this.len; // the rope can deform past its length, but pulls back with a force that grows the further it goes
                const f = Math.max(0, (this.onBall ? KB : KS) * (heavy ? HEAVY_KS : 1) * x * (1 + x / STRETCH_X0) - (this.onBall ? DB : DAMP) * Math.min(0, closing)); // damp only while the rope is being stretched; the recoil is undamped so the pull-back keeps its energy
                const pf = this.onBall ? BALL_PULL : 1; // platform ropes stay as they were
                this.vx += nx * f * DT * pf;
                this.vy += ny * f * DT * pf;
                if (this.onBall) {
                    tb.vx -= nx * f * DT / BALL_TM;
                    tb.vy -= ny * f * DT / BALL_TM;
                    tb.w += (rx * (-ny * f) - ry * (-nx * f)) * DT / BALL_I; // torque from pulling on the edge
                }
                const lim = this.len * 3 + 200;
                if (!this.onBall && d > lim) { // failsafe only; the progressive spring normally stops you long before this
                    this.x = a.x - nx * lim;
                    this.y = a.y - ny * lim;
                    if (closing < 0) {
                        this.vx -= closing * nx;
                        this.vy -= closing * ny;
                    }
                }
            }
            if (TAUT_K > 0 && !this.onBall && this.ropeGround) { // taut floor tether: hang above the pivot instead of dropping onto it
                const s = Math.max(0, Math.min(1, (ny - TAUT_MIN_NY) / 0.3)); // 1 with the pivot straight below, 0 once it is off to the side
                if (!this.taut && d >= this.len)
                    this.taut = true; // the grapple-jump slack is used up
                // Float weight: dribbling overrides the float (fast fade out), then it settles back in slowly so there is no pop.
                const wT = this.dribT > 0 ? 0 : 1;
                this.floatW += (wT - this.floatW) * Math.min(1, (wT ? FLOAT_ON_RATE : FLOAT_OFF_RATE) * DT);
                const fw = this.floatW * s;
                if (this.taut && fw > 0.001) {
                    if (d < this.len) { // closer than the rope's length: below the neutral float point
                        const x = this.len - d;
                        const bd = BOB_DEPTH + BOB_KICK_BONUS * (this.dribT / DRIB_T); // bob zone: a little sag is allowed, wider right after a kick
                        const xe = x <= bd ? x * BOB_SOFT : bd * BOB_SOFT + (x - bd); // soft spring inside the bob zone, full strength past it
                        const f = Math.max(0, TAUT_K * (heavy ? HEAVY_KS : 1) * xe * (1 + xe / STRETCH_X0) + TAUT_DAMP * closing) * fw;
                        this.vx -= nx * f * DT;
                        this.vy -= ny * f * DT;
                    }
                    if (!this.ground) { // airborne above the pivot: pull back over it and damp sideways speed, so the float is stable
                        this.vx -= (this.x - a.x) * TAUT_CENTER * fw * DT;
                        this.vx *= 1 - TAUT_DRAG * fw * DT;
                    }
                }
            }
        }
        this.prevX = k.x;
        this.vy += g * DT;
        this.vx *= 1 - 0.1 * DT;
        this.x += this.vx * DT;
        this.y += this.vy * DT;
        // The hook is just the rope's anchor point: nothing blocks you from reaching it, so you can swing straight through the pivot and out the other side.
        for (const q of pegs)
            pegBounce(this, q);
        // Floor + slopes are solved in the floor's own frame (it can be raised and moving), then everything moves back: the floor's
        // speed is handed to whoever rests on it, which is how a pop kicks things up.
        const o = sawY(this.x), vo = sawV(this.x);
        this.y -= o;
        this.vy -= vo;
        this.hit = 0;
        const tg = collideTerrain(this, 0, vo);
        if (this.y + this.r > H) {
            this.hit = Math.max(this.hit, this.vy + vo);
            this.y = H - this.r;
            if (this.vy > 0)
                this.vy = 0;
        }
        const gf = tg || this.y + this.r >= H - 1.5;
        this.y += o;
        this.vy += vo;
        sawHit(this.x, this.hit);
        this.ground = collideTerrain(this, 0, 0, LEDGES, LEDGE_T) || gf;
        if (collideTerrain(this, 0.2, 0, NETSEGS, NET_T))
            this.ground = true; // landing on top of the net's cut end counts as ground
        if (collideTerrain(this, 0, 0, stuckSegs, ARROW_HALF_W))
            this.ground = true; // standing on a stuck arrow counts as ground
        if (this.rope && !this.onBall && this.ropeGround && this.hit > PIVOT_MIN_HIT && Math.hypot(this.rope.x - this.x, this.rope.y - this.y) < PIVOT_ZONE) {
            // Hit the pivot: the speed the floor just absorbed goes sideways instead. Direction = the way you steer, else the way you were already
            // travelling, else out the side opposite to the one you came in on.
            const sgn = dir !== 0 ? dir : Math.abs(this.vx) > 10 ? Math.sign(this.vx) : this.pivotSide ? -this.pivotSide : 1;
            const add = this.hit * PIVOT_TRANSFER;
            this.vx = sgn * Math.hypot(this.vx * (Math.sign(this.vx) === sgn ? 1 : 0), add);
        }
        if (this.y - this.r < 0) {
            this.y = this.r;
            if (this.vy < 0)
                this.vy *= -0.05;
        } // demo: ceiling hits barely rebound
        const lo = this.r; // players may now cross the net through its gap, so only the outer walls limit them
        const hi = W - this.r;
        if (this.x < lo) {
            this.x = lo;
            if (this.vx < 0)
                this.vx *= -0.2;
        }
        if (this.x > hi) {
            this.x = hi;
            if (this.vx > 0)
                this.vx *= -0.2;
        }
        // Net guard: the net is a thin wall, so a very fast player could jump clean through it in one step. If we ended up on the other side of the net
        // while below its gap, put us back against the face we came from. (Crossing through the gap is fine: we are above NET_GAP then.)
        const side = this.x < NETX ? 0 : 1;
        if (this.netSide !== undefined && side !== this.netSide && this.y + this.r > NET_GAP + 0.5) {
            this.x = NETX + (this.netSide ? this.r : -this.r);
            if (this.vx * (this.netSide ? 1 : -1) < 0)
                this.vx *= -0.2;
        } else
            this.netSide = side;
    }
}
