// PHYSICS - Player: movement, grapple rope, and special abilities (dash / plinko / marionette / decoy / arrow / bat / barbwire / warp / awakened / explode).
// step(ball) advances one fixed timestep. Reads this.keys; never draws.
const noKeys = () => ({ l: false, r: false, up: false, z: false, x: false, sp: false, sp2: false, dn: false }); // sp = first special, sp2 = second special (only when twoSpecials), dn = down, z = grapple, x = weight
const AIMING = ['arrow', 'marionette', 'bat']; // casts that read the arrow keys live to aim: only one of them can run at a time
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
        for (const a of arrows) // arrows last: they are not tracked in the c.hits mask (their own immunity timer stops a second hit instead)
            if (BAT_HITS_STUCK_ARROWS || !a.stuck)
                targets.push(a);
    }
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const ax = Math.cos(c.ang), ay = Math.sin(c.ang); // the way the bat was aimed (the direction held)
    const s = ax >= 0 ? 1 : -1, stepAng = Math.abs(wrap(th - prev)); // s: swing direction, stepAng: how far the bat moved this step
    for (let i = 0; i < targets.length; i++) {
        const b = targets[i], isArrow = b.stuck !== undefined, bit = isArrow ? 0 : 1 << i; // (only arrows have a `stuck` field)
        if (isArrow ? b.immune > 0 : c.hits & bit)
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
        const out = isArrow ? Math.min(BAT_ARROW_VMAX + BAT_VMAX_CHARGE * c.pow, (BAT_ARROW_V + BAT_ARROW_KEEP * sp) * pow)
            : isPlayer ? Math.min(BAT_PLAYER_VMAX * pow, (BAT_PLAYER_V + BAT_PLAYER_KEEP * sp) * pow) : Math.min(BAT_VMAX + BAT_VMAX_CHARGE * c.pow, (BAT_V + BAT_KEEP * sp) * pow);
        const nvx = ux * out + p.vx * BAT_CARRY, nvy = uy * out + p.vy * BAT_CARRY;
        if (isArrow)
            arrowKnock(b, nvx, nvy, ARROW_DEFLECT_TEAM ? p.team : null, ARROW_DEFLECT_TEAM ? p : null);
        else {
            b.vx = nvx;
            b.vy = nvy;
        }
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
        this.driveT = 0; this.driveAcc = 0; this.driveVmax = 0; // the grapple-jump drive still running (see GJ_DRIVE_T): seconds left, and its acceleration (u/s^2)
        this.tball = null; // the ball (the death ball or a decoy) we are tethered to while onBall
        this.taut = false;
        this.floatW = 1; // grapple-float weight 0..1: dribbling fades it out so the rope can pull you in, then it eases back
        this.dribT = 0;  // seconds left of the 'dribbling' window opened by a weighted kick
        this.sim = false; // true on the AI planner's throwaway copies: they must not touch the real game (spawn decoys / pegs)
        this.keys = noKeys();
        this.special = 'dash'; // chosen special ability (see SPECIALS)
        this.special2 = 'plinko'; // second special (only used while twoSpecials is on; never the same as `special`)
        this.prevSp2 = false;
        this.warp = null; // Warp: the placed marker { x, y }, or null (replaced, never edited in place, so the AI's shallow copies are safe)
        this.awakeT = 0; // Awakened: seconds of power-up left (0 = not awake)
        this.exploT = 0; // Explode: seconds left in which a death refunds the cooldown (0 = no blast to reward)
        this.exploDead = 0; // Explode: how many players were already dead when the blast went off
        this.exploCarry = false; // Explode: a refund was earned, so the next round starts with it ready (see reset)
        this.explodeFx = null; // Explode: the last blast { t, x, y, hits: [{ x, y, r }] } (the zone, and a flash on each body it hit); t counts down from EXPLODE_FX
        this.warpFx = null; // Warp: the last teleport { t, ax, ay, bx, by } (a short visual: rings at both ends); t counts down from WARP_FX
        this.arrowAng = -Math.PI / 2; // last arrow aim, kept across rounds (so not in reset())
        this.reset();
    }
    reset() {
        this.x = sidesSwapped ? W - this.sx : this.sx; // sx is the spawn on the team's normal side; a swapped team spawns mirrored
        this.y = H - this.r;
        this.vx = this.vy = 0;
        this.alive = true;
        this.rope = null;
        this.pending = null;
        this.awakeT = 0; // Awakened never survives the round
        this.gCharge = GRAPPLE_MAX; // grapple meter: seconds of grip left
        this.gCool = 0;             // > 0: the meter was spent; no grappling at all until this runs out (then the meter restarts from 0 and refills passively)
        this.onBall = false;
        this.ground = false;
        this.ropeBase = null;
        this.netSide = undefined; // which side of the net we were last on (0 left, 1 right); set after the first step
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.driveT = 0; this.driveAcc = 0; this.driveVmax = 0; // the grapple-jump drive still running (see GJ_DRIVE_T): seconds left, and its acceleration (u/s^2)
        this.dashReady = true; // one dash per trip off the floor
        this.tball = null;
        this.cd = { dash: 0, plinko: 0, marionette: 0, decoy: 0, arrow: 0, bat: 0, barbwire: 0, warp: 0, awakened: 0, explode: 0 }; // per-ability cooldown remaining (s)
        this.warp = null; // a marker never survives the round
        this.warpFx = null;
        for (const id in ABILITY)
            this.cd[id] = ABILITY[id].cd * START_CD;
        if (this.exploCarry)
            this.cd.explode = 0; // earned by a kill that ended the last round: start this one with Explode ready
        this.exploCarry = false;
        this.exploT = 0;
        this.explodeFx = null;
        this.casts = []; // abilities being cast right now, at most one per special key: { type, key, t, t0, hx, hy, x, y, ... }
        this.dashT = 0;
        this.dashDir = [0, 0];
        this.prevSp = false;
        this.prevSp2 = false;
        this.arrowQueued = false;
        this.gBurst = 0;
    }
    get grounded() { return this.ground; }
    // The specials that are active right now, as [key, ability id]: the first always, the second only when the match uses two and it is not the same ability.
    slots() { return twoSpecials && this.special2 && this.special2 !== this.special ? [['sp', this.special], ['sp2', this.special2]] : [['sp', this.special]]; }
    has(id) { return this.slots().some(s => s[1] === id); }
    casting(type) { return this.casts.find(c => c.type === type) || null; } // the running cast of this kind, or null
    endCast(c) {
        const i = this.casts.indexOf(c);
        if (i >= 0)
            this.casts.splice(i, 1);
    }
    get crashK() { return this.awakeT > 0 ? AWAKENED_CRASH : 1; } // Awakened: multiplier on the push your crashes give to balls, decoys and players
    // Overcharge: the meter is emptied, the grapple is locked out for GRAPPLE_COOLDOWN and the grip is torn away (purple ripple). Happens when the meter runs out, or when a
    // player with their grapple active (rope out, or hook in flight) touches an enemy (see update() in rules.js).
    overcharge() {
        if (this.awakeT > 0)
            return; // Awakened: never overcharged, whatever the cause
        this.gCharge = 0;
        this.gCool = GRAPPLE_COOLDOWN;
        this.gBurst = GRAPPLE_BURST_T;
        this.kickReq = false;
        this.driveT = 0;
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
        return c.filter(o => o.d <= RANGE);
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
        this.driveT = 0;
        if (ground && this.vy <= 0) {
            const chain = Math.min(GJ_MAX, GJ_START * Math.pow(GJ_GROWTH, this.gjN)); // exponential ramp over a spammed chain
            const lift = LIFT_V * chain * (this.keys.x ? WEIGHT_M : 1);
            this.gjN++;
            this.gjT = 0;
            // The rope's length becomes the reach: one more GJ_REACH_GROUND out than we are now (on a platform that is a player length off it), never past RANGE.
            // Latching high above the pivot (already airborne) is weaker than a jump off the platform: full strength within GJ_NEAR u of the pivot, fading to GJ_AIR_SCALE by GJ_FAR u.
            const air = 1 - (1 - GJ_AIR_SCALE) * Math.max(0, Math.min(1, (d - GJ_NEAR) / (GJ_FAR - GJ_NEAR)));
            this.len = Math.min(RANGE, Math.max(d, MIN_LEN) + GJ_REACH_GROUND * air * (this.keys.x ? GJ_REACH_WEIGHTED : 1));
            this.driveT = GJ_DRIVE_T;
            this.driveVmax = lift * GJ_DRIVE_BOOST * air; // top speed away from the pivot this jump can reach
            this.driveAcc = this.driveVmax / GJ_DRIVE_T; // delivered by step() as a pull away from the pivot, not as one kick
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
    // Awakened on / off. Powering up lifts a grapple lockout that is running (the meter restarts from 0, as when a lockout ends). Wearing off starts the cooldown;
    // being swapped away from (cooling = false) does not.
    setAwake(on, cooling = true) {
        if (on) {
            this.awakeT = AWAKENED_T;
            if (this.gCool > 0) {
                this.gCool = 0;
                this.gCharge = 0;
            }
        } else {
            this.awakeT = 0;
            if (cooling)
                this.cd.awakened = AWAKENED_COOLDOWN;
        }
    }
    // Explode key press (instant): every other living player, and the death ball and every decoy, whose edge is within EXPLODE_R of our centre gets an ADDITIVE kick. The kick is stronger
    // the closer the body is (EXPLODE_KICK_MIN at the edge .. EXPLODE_KICK_MAX in the middle), and it follows the body's own motion where it has some (so it amplifies a swing / a shot) and
    // goes straight away from us where it has none. Starts the cooldown and the EXPLODE_WINDOW in which a death refunds it (checked in update(), rules.js). The AI's planning copies only
    // do their own bookkeeping, they never touch the real game.
    explode() {
        const hits = []; // every body the blast pushes: where it was, which way it was sent and how hard (0..1), so the drawing can flash and streak exactly those
        this.explodeFx = { t: EXPLODE_FX, x: this.x, y: this.y, hits };
        this.cd.explode = EXPLODE_COOLDOWN;
        this.exploT = EXPLODE_WINDOW;
        this.exploDead = players.filter(q => !q.alive).length;
        if (this.sim)
            return;
        const blast = q => { // push one body (player, ball, decoy or arrow) if it is touching the blast radius
            const isArrow = q.stuck !== undefined, qr = q.r === undefined ? ARROW_R : q.r;
            if (isArrow && q.immune > 0)
                return;
            const dx = q.x - this.x, dy = q.y - this.y, d = Math.hypot(dx, dy), reach = EXPLODE_R + qr;
            if (d > reach)
                return;
            const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1; // (exactly on top of us: straight up)
            const power = Math.pow(1 - Math.min(1, d / reach), EXPLODE_FALLOFF); // 1 on top of us, 0 at the edge
            let kick = EXPLODE_KICK_MIN + (EXPLODE_KICK_MAX - EXPLODE_KICK_MIN) * power;
            // Amplify: the part of its motion that is not heading into us (a body flying at us keeps only its sideways motion)
            const into = Math.min(0, q.vx * nx + q.vy * ny), mx = q.vx - into * nx, my = q.vy - into * ny, ms = Math.hypot(mx, my);
            let ux = nx, uy = ny;
            if (ms > 1e-6) {
                const w = Math.min(1, ms / EXPLODE_AMP_SPEED) * EXPLODE_AMP_BLEND; // a body that is barely moving is pushed radially; a fast one along its motion
                ux = nx * (1 - w) + (mx / ms) * w;
                uy = ny * (1 - w) + (my / ms) * w;
                const m = Math.hypot(ux, uy) || 1;
                ux /= m;
                uy /= m;
                kick += ms * EXPLODE_AMP_GAIN; // extra speed on top of what it already has
            }
            hits.push({ x: q.x, y: q.y, r: qr, ux, uy, k: Math.min(1, kick / EXPLODE_KICK_MAX) });
            if (isArrow)
                arrowKnock(q, q.vx + ux * kick, q.vy + uy * kick);
            else {
                q.vx += ux * kick;
                q.vy += uy * kick;
            }
            if (q.boost !== undefined) { // a ball already flying fast: lift its speed cap for a moment (like a crash shot or a hatchet hit) so the push is not clipped
                const s = Math.hypot(q.vx, q.vy);
                if (s > BALL_VMAX)
                    q.boost = Math.max(q.boost, Math.min(1, (s - BALL_VMAX) / (PAD_MAX - BALL_VMAX)));
            }
        };
        for (const q of players)
            if (q !== this && q.alive)
                blast(q);
        blast(ball);
        for (const d of decoys)
            if (!d.dead)
                blast(d);
        for (const a of arrows)
            blast(a);
    }

    // A death happened within the window: the cooldown is refunded (and, if EXPLODE_CARRY, kept through the round reset that a kill ending the round is followed by).
    explodeRefund() {
        this.cd.explode = 0;
        this.exploT = 0;
        if (EXPLODE_CARRY)
            this.exploCarry = true;
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
    // A special key went down (or a queued arrow came off cooldown): start that ability. Returns true if it started or fired.
    startAbility(id, key, ball) {
        const k = this.keys, hx = (k.r ? 1 : 0) - (k.l ? 1 : 0), hy = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
        if (AIMING.includes(id) && this.casts.some(c => AIMING.includes(c.type)))
            return false; // two aiming casts would fight over the same arrow keys
        let c = null;
        if (id === 'dash' && this.dashReady && this.cd.dash <= 0 && (hx || hy) && !(this.ground && !hx && hy > 0)) // pushing straight down into the floor does not use it up
            c = { type: 'dash', t: DASH_CAST, t0: DASH_CAST, hx, hy };
        else if (id === 'plinko' && this.cd.plinko <= 0)
            c = { type: 'plinko', t: PLINKO_CAST, t0: PLINKO_CAST, hx, hy, x: this.x, y: this.y };
        else if (id === 'marionette' && this.cd.marionette <= 0) // starts aiming: no timer, it lasts as long as the key is held
            c = { type: 'marionette', aim: true, t: 1, t0: 1, hx, hy, grace: hx || hy ? MARIONETTE_GRACE : 0 };
        else if (id === 'decoy' && this.cd.decoy <= 0)
            c = { type: 'decoy', t: DECOY_CAST, t0: DECOY_CAST, hx, hy, x: this.x, y: this.y };
        else if (id === 'bat' && this.cd.bat <= 0) // charges while the key is held (aim read live), swings on release
            c = { type: 'bat', t: BAT_T, t0: BAT_T, charging: true, charge: 0, pow: 0, hx, hy, ang: hx || hy ? Math.atan2(hy, hx) : Math.atan2(ball.y - this.y, ball.x - this.x), hits: 0 };
        else if (id === 'barbwire' && this.cd.barbwire <= 0)
            c = { type: 'barbwire', t: 1, t0: 1, held: 0, roped: 0, hx, hy };
        else if (id === 'arrow' && this.cd.arrow <= 0)
            c = { type: 'arrow', t: 1, t0: 1, charge: 0, ang: this.arrowAng, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: k.l, r: k.r, u: k.up, d: k.dn } };
        else if (id === 'awakened') { // instant, no cast: power up if ready and not already awake
            if (this.cd.awakened <= 0 && this.awakeT <= 0) {
                this.setAwake(true);
                return true;
            }
        } else if (id === 'explode') { // instant, no cast
            if (this.cd.explode <= 0) {
                this.explode();
                return true;
            }
        } else if (id === 'warp') { // instant: no cast, no timer (see warpPress)
            this.warpPress();
            return true;
        }
        if (!c)
            return false;
        c.key = key; // the key that started it is the key that ends it
        this.casts.push(c);
        return true;
    }
    stepCast(c, k, ball) {
        const held = k[c.key || 'sp']; // the key that started this cast
        if (c.type === 'arrow') {
            arrowAimStep(c, k);
            this.arrowAng = c.ang;
            if (!held)
                c.t = 0; // released: fire (below)
        } else if (c.aim) { // marionette: follow the arrows while the key is held; letting go fires (or cancels if there is no direction)
            const ax = (k.r ? 1 : 0) - (k.l ? 1 : 0), ay = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
            if (ax || ay) {
                c.hx = ax;
                c.hy = ay;
                c.grace = MARIONETTE_GRACE;
            } else
                c.grace = Math.max(0, c.grace - DT);
            if (!held) {
                if ((c.hx || c.hy) && c.grace > 0)
                    c.t = 0; // released with a direction: fire (below)
                else
                    this.endCast(c); // released with none: cancelled, nothing spent
            }
        } else if (c.type === 'barbwire') {
            c.held += DT;
            if (this.rope || (this.pending && k.z))
                c.roped += DT; // time the wire was really out (hook in flight or tethered): only this costs cooldown
            if (!held || c.roped >= BARBWIRE_MAX_T)
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
                if (!held) { // released: swing
                    c.charging = false;
                    c.pow = c.charge;
                }
            } else {
                batStep(this, c, ball);
                c.t -= DT;
            }
        } else
            c.t -= DT;
        if (this.casts.includes(c) && c.t <= 0) {
            this.endCast(c);
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
    step(ball) {
        const k = this.keys, heavy = k.x;
        this.gjT += DT;
        this.dribT = Math.max(0, this.dribT - DT);
        if (this.gjT > GJ_CHAIN_T)
            this.gjN = 0; // chain broken
        const dir = this.casting('arrow') ? 0 : (k.r ? 1 : 0) - (k.l ? 1 : 0);
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
        if (!this.has('warp'))
            this.warp = null; // swapped to another special: the marker goes with it
        if (this.awakeT > 0) {
            if (!this.has('awakened'))
                this.setAwake(false, false); // swapped to another special: the power-up ends, no cooldown
            else if ((this.awakeT -= DT) <= 0)
                this.setAwake(false); // wore off: the cooldown starts now
        }
        if (this.warpFx && (this.warpFx = { ...this.warpFx, t: this.warpFx.t - DT }).t <= 0)
            this.warpFx = null;
        if (this.exploT > 0)
            this.exploT = Math.max(0, this.exploT - DT);
        if (this.explodeFx && (this.explodeFx = { ...this.explodeFx, t: this.explodeFx.t - DT }).t <= 0)
            this.explodeFx = null;
        this.gBurst = Math.max(0, this.gBurst - DT);
        // Start a cast. Each active special has its own key; a press of either starts that ability, unless a cast is already running (then it is ignored, like today).
        // To let the instant abilities (warp, awakened, explode) fire mid-cast, test them here before the `!this.cast` check.
        const slots = this.slots(), prev = { sp: this.prevSp, sp2: this.prevSp2 };
        for (const [key, id] of slots)
            if (id === 'arrow' && k[key] && this.cd.arrow > 0)
                this.arrowQueued = key; // held during cooldown: queue the next cast (arrowQueued holds the key it was queued on)
        if (this.arrowQueued && !k[this.arrowQueued])
            this.arrowQueued = false;
        for (const [key, id] of slots) {
            if (this.casts.some(c => c.key === key))
                continue; // that key already has a cast running
            const pressed = k[key] && !prev[key], queued = id === 'arrow' && this.arrowQueued === key && this.cd.arrow <= 0;
            if (!pressed && !queued)
                continue;
            if (this.startAbility(id, key, ball) && queued)
                this.arrowQueued = false; // (if the aiming rule refused it, the queue stays and tries again)
        }
        for (const c of this.casts.slice()) // (a copy: a cast removes itself from the list when it ends)
            this.stepCast(c, k, ball);
        this.prevSp = k.sp;
        this.prevSp2 = k.sp2;
        // Jump: pressing UP on the ground launches at JUMP_V. While UP stays held in the air, gravity drops to G_FLOAT, which
        // gives the long, symmetric float seen in the demo; releasing UP restores full gravity G. While tethered and
        // holding UP, a floaty arc keeps swings and floats working.
        if (k.up && this.grounded)
            this.vy = -JUMP_V;
        let g = (k.up ? G_FLOAT : G) * (heavy ? 1.35 : 1);
        if (k.up && this.rope) {
            g = (this.onBall ? G * 0.4 : G_FLOAT) * (heavy ? 1.35 : 1);
            const cap = this.onBall ? 170 : 70;
            if (this.vy > cap)
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
            if (this.awakeT <= 0) { // (Awakened: holding the grapple costs nothing)
                this.gCharge -= DT;
                if (this.gCharge <= 0) // spent: the grip is torn away
                    this.overcharge();
            }
        } else if (this.gCool <= 0)
            this.gCharge = Math.min(GRAPPLE_MAX, this.gCharge + GRAPPLE_REGEN * DT);
        if (!z) {
            this.driveT = 0;
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
            if (this.driveT > 0 && !this.onBall && this.ropeGround) { // grapple-jump drive: the rope accelerates you away from the pivot, out to its reach
                this.driveT -= DT;
                const room = this.len - d; // how far is left to the reach
                if (room > 0) {
                    let ux = -nx * HOP_AIM, uy = -ny;
                    const m = Math.hypot(ux, uy) || 1;
                    ux /= m; uy /= m;
                    const ease = Math.min(1, room / GJ_EASE); // glide in: the pull fades over the last GJ_EASE u
                    const out = this.vx * ux + this.vy * uy; // speed already heading away from the pivot: the drive never pushes past this jump's top speed, so a regrab on the way up cannot stack
                    if (out < this.driveVmax) {
                        const add = Math.min(this.driveAcc * ease * DT, this.driveVmax - out);
                        this.vx += ux * add;
                        this.vy += uy * add;
                    }
                }
            }
            if (this.kickReq && !this.onBall) {
                // Below the float point (once the grapple jump's slack is used up) a press does nothing: no force is added,
                // so only your momentum and gravity carry you. The taut check keeps the weighted grapple-jump kick working.
                const below = this.ropeGround && this.taut && d < this.len - DRIB_BELOW_TOL;
                if (!below) {
                    const past = Math.max(0, d - this.len);
                    const room = Math.max(0, 1 - past / WEIGHT_KICK_REACH);
                    const want = WEIGHT_KICK * room * (this.ropeGround ? 1 : WALL_KICK_SCALE);

                    // Kick direction: away from the pivot, reshaped by the arrows. Only once the float is established (taut),
                    // so the weighted grapple-jump launch keeps its direction.
                    let ux = -nx, uy = -ny;
                    if (this.taut && this.ropeGround) {
                        const vert = k.up || k.dn, horiz = dir !== 0;
                        if (vert && !horiz)
                            uy *= KICK_STEEP;                  // up / down only: steeper
                        else if (horiz && !vert) {
                            uy *= KICK_FLAT;                   // left / right only: flatter, leaning the way you hold
                            ux += dir * KICK_STEER;
                        }
                        // both (diagonal) or neither: plain radial direction
                        const m = Math.hypot(ux, uy) || 1;
                        ux /= m;
                        uy /= m;
                    }
                    const out = this.vx * ux + this.vy * uy;
                    const add = Math.max(0, want - out);
                    this.vx += ux * add;
                    this.vy += uy * add;
                }
                this.kickReq = false;          // the press is used up either way
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
                const f = Math.max(0, (this.onBall ? KB : KS) * (this.onBall || this.ropeGround ? 1 : WALL_KS_SCALE) * (heavy ? HEAVY_KS : 1) * x * (1 + x / STRETCH_X0)
                    - (this.onBall ? DB : DAMP) * Math.min(0, closing)
                    - (this.onBall ? 0 : RETURN_DAMP) * Math.max(0, closing));
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
                const s = Math.max(0, Math.min(1, (ny - TAUT_MIN_NY) / TAUT_FADE));
                if (!this.taut && d >= this.len)
                    this.taut = true; // the grapple-jump slack is used up
                if (this.taut && this.len - d > FLOAT_RELEASE_DEPTH)
                    this.dribT = DRIB_T;   // sank clearly below the float point: the float steps aside and you fall to the pivot
                // Float weight: dribbling overrides the float (fast fade out), then it settles back in slowly so there is no pop.
                const wT = this.dribT > 0 ? 1 - DRIB_FLOAT_FADE : 1; // (0 fade = the float never steps aside, so the rope's rubber band alone brings you back)
                this.floatW += (wT - this.floatW) * Math.min(1, (wT >= this.floatW ? FLOAT_ON_RATE : FLOAT_OFF_RATE) * DT);
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
                    if (!this.ground && dir === 0) {   // no sideways centering or drag while you steer
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
            const keep = Math.sign(this.vx) === sgn ? 1 : PIVOT_TURN_KEEP;
            this.vx = sgn * Math.hypot(this.vx * keep, add);
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