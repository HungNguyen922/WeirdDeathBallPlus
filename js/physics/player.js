// PHYSICS - Player: movement, grapple rope, and special abilities (dash / plinko / marionette / decoy).
// step(ball) advances one fixed timestep. Reads this.keys; never draws.
const noKeys = () => ({ l: false, r: false, up: false, z: false, x: false, sp: false, dn: false }); // sp = special ability, dn = down, z = grapple, x = weight
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
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.liftX = this.liftY = 0; this.liftT = 1e9; // the kick still being delivered (see LIFT_RAMP)
        this.tball = null; // the ball (the death ball or a decoy) we are tethered to while onBall
        this.sim = false; // true on the AI planner's throwaway copies: they must not touch the real game (spawn decoys / pegs)
        this.keys = noKeys();
        this.special = 'dash'; // chosen special ability (see SPECIALS)
        this.reset();
    }
    reset() {
        this.x = this.sx;
        this.y = H - this.r;
        this.vx = this.vy = 0;
        this.alive = true;
        this.rope = null;
        this.pending = null;
        this.gCharge = GRAPPLE_MAX; // grapple meter: seconds of grip left
        this.gCool = 0;             // > 0: the meter was spent; no grappling at all until this runs out (then it is full again)
        this.onBall = false;
        this.ground = false;
        this.ropeBase = null;
        this.netSide = undefined; // which side of the net we were last on (0 left, 1 right); set after the first step
        this.gjN = 0; this.gjT = 99;               // grapple-jump chain: jumps so far, seconds since the last one
        this.liftX = this.liftY = 0; this.liftT = 1e9; // the kick still being delivered (see LIFT_RAMP)
        this.dashReady = true; // one dash per trip off the floor
        this.tball = null;
        this.cd = { dash: 0, plinko: 0, marionette: 0, decoy: 0, arrow: 0  }; // per-ability cooldown remaining (s)
        this.cast = null; // ability being cast: { type, t, t0, hx, hy, x, y }
        this.dashT = 0;
        this.dashDir = [0, 0];
        this.prevSp = false;
    }
    get grounded() { return this.ground; }
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
        if (ground && this.vy < 0) {
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
            this.len += lift * 0.15;
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
    step(ball) {
        const k = this.keys, heavy = k.x;
        this.gjT += DT;
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
        // Start a cast. The arrow(s) held at the press are remembered (dash direction / plinko displacement); plinko also remembers the spot.
        if (!this.cast && k.sp && !this.prevSp) {
            const hx = (k.r ? 1 : 0) - (k.l ? 1 : 0), hy = (k.dn ? 1 : 0) - (k.up ? 1 : 0);
            if (this.special === 'dash' && this.dashReady && this.cd.dash <= 0 && (hx || hy) && !(this.ground && !hx && hy > 0)) // pushing straight down into the floor does not use it up
                this.cast = { type: 'dash', t: DASH_CAST, t0: DASH_CAST, hx, hy };
            else if (this.special === 'plinko' && this.cd.plinko <= 0)
                this.cast = { type: 'plinko', t: PLINKO_CAST, t0: PLINKO_CAST, hx, hy, x: this.x, y: this.y };
            else if (this.special === 'marionette' && this.cd.marionette <= 0) // starts aiming: no timer, it lasts as long as the key is held
                this.cast = { type: 'marionette', aim: true, t: 1, t0: 1, hx, hy, grace: hx || hy ? MARIONETTE_GRACE : 0 };
            else if (this.special === 'decoy' && this.cd.decoy <= 0)
                this.cast = { type: 'decoy', t: DECOY_CAST, t0: DECOY_CAST, hx, hy, x: this.x, y: this.y }; // remembers the spot (and the arrows) at the press, like plinko
            else if (this.special === 'arrow' && this.cd.arrow <= 0)
                this.cast = { type: 'arrow', t: 1, t0: 1, charge: 0, ang: -Math.PI / 2, noTilt: false, tap: { l: 0, r: 0, u: 0, d: 0 }, prev: { l: k.l, r: k.r, u: k.up, d: k.dn } };

        }
        if (this.cast) {
            const c = this.cast;
            if (c.type === 'arrow') {
                arrowAimStep(c, k);
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
        if (k.x && !this.prevX)
            this.kickReq = true; // remembered until the hook lands, so a delayed hook still gets its kick
        // Grapple meter: GRAPPLE_MAX seconds of use (rope out, or hook in flight). Spend it all and the grapple is locked out for GRAPPLE_COOLDOWN seconds,
        // then comes back full. Letting go at any point refills it over time instead.
        if (this.gCool > 0) {
            this.gCool = Math.max(0, this.gCool - DT);
            if (this.gCool === 0)
                this.gCharge = GRAPPLE_MAX;
        }
        const z = k.z && this.gCool <= 0;
        if (!z)
            this.kickReq = false;
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
            if (this.gCharge <= 0) { // spent: the grip is torn away
                this.gCharge = 0;
                this.gCool = GRAPPLE_COOLDOWN;
                this.kickReq = false;
                this.rope = null;
                this.pending = null;
                this.onBall = false;
                this.tball = null;
            }
        } else if (this.gCool <= 0)
            this.gCharge = Math.min(GRAPPLE_MAX, this.gCharge + GRAPPLE_REGEN * DT);
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
                this.vx -= nx * WEIGHT_KICK;
                this.vy -= ny * WEIGHT_KICK;
                this.kickReq = false;
            } // weight press: kick away from the pivot
            if (d > this.len) {
                if (this.onBall) {
                    // Rope = distance constraint on the ball: cancel only the speed that would stretch it (mass-weighted, so the
                    // light ball takes the correction). Tangential speed survives, so the ball keeps circling the player.
                    const c = rx * ny - ry * nx, im = 1 + 1 / BALL_M + c * c / BALL_I;
                    if (closing < 0) {
                        const J = -closing * BALL_RIGID / im;
                        this.vx += nx * J;
                        this.vy += ny * J;
                        tb.vx -= nx * J / BALL_M;
                        tb.vy -= ny * J / BALL_M;
                        tb.w -= J * c / BALL_I;
                    }
                }
                const x = d - this.len; // the rope can deform past its length, but pulls back with a force that grows the further it goes
                const f = Math.max(0, (this.onBall ? KB : KS) * (heavy ? HEAVY_KS : 1) * x * (1 + x / STRETCH_X0) - (this.onBall ? DB : DAMP) * Math.min(0, closing)); // damp only while the rope is being stretched; the recoil is undamped so the pull-back keeps its energy
                this.vx += nx * f * DT;
                this.vy += ny * f * DT;
                if (this.onBall) {
                    tb.vx -= nx * f * DT / BALL_M;
                    tb.vy -= ny * f * DT / BALL_M;
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
