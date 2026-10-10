// ---- AI opponent: toggle either player with the buttons under the game, or keys 1 (Blue) / 2 (Red) ----
// The AI plays a few simple tactics and leans on the real physics to check them:
//   ENGAGE   walk to a stand-off from the ball, then ask "if I jump right now, do I latch onto the ball and stay clear of it?" by playing that jump forward on a copy of the
//            game; jump the first moment the answer is yes. (The grapple only latches onto the nearest thing, so we have to be airborne and over the ball.)
//            The same check is the DEFENSE: a ball rolling or flying at us gets the same jump-and-grab, which also stops it going into our goal.
//   HOLD     once tethered, play a few plans forward and keep the best one:
//              shootU / shootF  dash toward their goal (up-and-over / flat) so the rope whips the ball along, and let go the moment the ball would end up in their goal
//              pull             run back toward our own side, dragging the ball out of the middle to somewhere with room for a shot
//              push             carry it upfield when it is stuck far back in our own half
//              hold             hang on
//   DODGE    otherwise, if the ball is going to reach us: try each way of steering (left / right / still, jump / not) on a rough model and take the one that keeps us furthest from it.
//   WAIT     far away or ball on their side: wait near the net.
// The grapple has a meter (4 s of grip, then a 6 s lockout; letting go refills it), so the AI only goes for a grab with enough left, and never holds on for ever.
// Playing things forward costs ~17 us per physics step, so those look-aheads are written as generators and run a few steps per tick (AI_SLICE), never all at once.
// A job first plays forward the ticks it is itself going to take (AI_PRE, keys frozen), so its answer is about the moment it arrives, not the moment it started.
const AI_THREAT = 50; // dodge when the ball would get this close (u; touching is 30)
const ai = [0, 1, 2, 3].map(() => ({ on: false, plan: null, t: 0, age: 0, noGrab: 0, held: false }));
function aiReset(i) { // forget everything it was in the middle of (new round, or switched on / off)
    Object.assign(ai[i], { plan: null, t: 0, age: 0, noGrab: 0, held: false, hs: null, E: null, job: null, cool: 0, jcool: 0, fails: 0, idle: 0, stand: undefined, threat: false });
}
// The rollouts step real physics objects, which nudges a few shared effect values (seesaw, hatchet glow, peg flash). Snapshot and restore them.
function snapshotFx() { return { sv: saw.v, st: saw.t, hp: [...padFlash], pf: pegs.map(q => q.flash) }; }
function restoreFx(s) {
    saw.v = s.sv;
    saw.t = s.st;
    padFlash[0] = s.hp[0];
    padFlash[1] = s.hp[1];
    pegs.forEach((q, n) => { q.flash = s.pf[n]; });
}
function aiClone(p) {
    const c = Object.assign(Object.create(Player.prototype), p);
    c.keys = { ...p.keys };
    c.rope = p.rope ? { ...p.rope } : null;
    c.ropeBase = p.ropeBase ? { ...p.ropeBase } : null;
    c.pending = p.pending ? { ...p.pending, p: { ...p.pending.p } } : null;
    c.cast = p.cast ? { ...p.cast } : null;
    c.cd = { ...p.cd };
    c.dashDir = [...p.dashDir];
    c.sim = true; // a planning copy: it must never add pegs / decoys to the real game
    return c;
}

// ---- flight prediction (no physics objects, ~100 cheap iterations): if the ball is let go now, does it end up in the goal that `team` attacks? ----
// Mirrored for team 1 so the goal is always at x = W. Ignores the players; a ball that lands on the floor only counts if it is still moving fast (it rolls up the ramp).
const AI_FLIGHT_STEPS = 200;
function aiFloorY(x) { // the arena floor under x (the hills at the net and the goal ramps)
    return H - RISE * (Math.max(0, 1 - Math.abs(x - NETX) / RUN) + Math.max(0, 1 - (W - x) / RUN) + Math.max(0, 1 - x / RUN));
}
function aiFlight(b, team) {
    const m = team === 0 ? 1 : -1, dt = 1 / 60, r = BALL_R, roof = GOAL_Y0 + LEDGE_T + r;
    let x = team === 0 ? b.x : W - b.x, y = b.y, vx = b.vx * m, vy = b.vy;
    for (let n = 0; n < AI_FLIGHT_STEPS; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        x += vx * dt;
        y += vy * dt;
        if (y < r) { y = r; if (vy < 0) vy = 0; }
        if (x > W + OUT_D)
            return true;                       // through the threshold line
        if (x > W - PL - r && y < roof)
            return false;                      // hit the jut above the goal
        if (x < 0 || (vx < 30 && n > 20))
            return false;                      // going the wrong way / stalled
        if (x > W)
            continue;                          // in the tunnel: the hatchet bounces anything out
        if (y + r > aiFloorY(x))
            return vx > 230 && x > NETX * 0.6; // floor: only a hard-rolling ball makes it up the ramp
    }
    return false;
}
// The closest we and the free ball get over the next 0.6 s if we hold this steering (dir -1/0/1, up = jump / float). Both move ballistically (cheap and rough): this is what
// lets the AI see that it is about to fall onto a ball lying on the floor, or that a rolling ball will reach it, and pick the way out.
function aiPathMin(me, b, dir, up, lo, hi) {
    let x = me.x, y = me.y, vx = me.vx, vy = me.vy, grounded = me.ground, bx = b.x, by = b.y, bvx = b.vx, bvy = b.vy, min = 1e9;
    const dt = 1 / 60;
    if (up && grounded) {
        vy = -JUMP_V;
        grounded = false;
    }
    for (let n = 0; n < 36; n++) {
        if (dir) {
            if (dir * vx < 330)
                vx += dir * RUN_ACC * (grounded ? 1 : 0.55) * (dir * vx < 0 ? 1.4 : 1) * dt;
        } else if (grounded)
            vx *= 1 - GROUND_BRAKE * dt;
        if (!grounded)
            vy += (up ? G_FLOAT : G) * dt;
        x = Math.max(lo, Math.min(hi, x + vx * dt));
        y += vy * dt;
        const f = aiFloorY(x) - me.r;
        grounded = y >= f;
        if (grounded) {
            y = f;
            vy = Math.min(vy, 0);
        }
        bvy += BALL_G * dt;
        bx += bvx * dt;
        by += bvy * dt;
        const fb = aiFloorY(bx) - BALL_R;
        if (by > fb) {
            by = fb;
            bvy = 0;
            bvx *= 1 - BALL_ROLL_DRAG * dt;
        }
        min = Math.min(min, Math.hypot(x - bx, y - by));
    }
    return min;
}
// When will the free ball reach us (come within 50 u of our x, on its way to our goal)? { t, y } or null. Cheap and rough, like aiThreat.
function aiArrival(me) {
    const s = aiSide(me);
    let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
    if (vx * s > -90 || (x - me.x) * s < 0)
        return null;                           // not coming at us (or already past)
    const dt = 1 / 60;
    for (let n = 1; n <= 150; n++) {
        vy += BALL_G * dt;
        x += vx * dt;
        y += vy * dt;
        const f = aiFloorY(x) - BALL_R;
        if (y > f) { y = f; vy = 0; vx *= 1 - BALL_ROLL_DRAG * dt; }
        if ((x - me.x) * s < 50)
            return { t: n * dt, y };
    }
    return null;
}

// ---- tactics ----
const AI_GRIP_MIN = 1.6, AI_FLOAT_T = 0.8, AI_JUMP_HOLD = 0.6, AI_STAND = 90, AI_STANDS = [90, 130, 70, 160, 110], AI_HOLD_MAX = 1.6;
const AI_SLICE = 16, AI_PRE = 16;          // jump jobs: physics steps per tick, and the ticks of latency they plan around
const AI_SLICE_H = 32, AI_PRE_H = 24;      // held-plan jobs: bigger, because they must finish within their latency window (AI_PRE_H ticks) to be about the moment they land
const AI_JUMP_STEPS = 120, AI_SAFE_STEPS = 36, AI_HELD_STEPS = 96, AI_AFTER_STEPS = 72; // look-ahead lengths (steps): a jump, the safe time after latching, a held plan, the time after a release
const aiSide = me => (me.team === 0 ? 1 : -1);
const aiNoKeys = () => ({ l: false, r: false, up: false, dn: false, z: false, x: false, sp: false });
const aiNearest = (me, b) => me.candidates(b).reduce((m, o) => (!m || o.d < m.d ? o : m), null);
const aiCanDash = me => me.special === 'dash' && me.dashReady && me.cd.dash <= 0;
const aiCanGrip = me => me.gCool <= 0 && me.gCharge > AI_GRIP_MIN; // the grapple meter: enough left to latch on and do something with it

// Keys for a tethered AI. hs = { t: seconds since the latch, plan, dashT: when we dashed (or null), n: tick counter }.
function aiHeldKeys(me, b, hs, k) {
    const s = aiSide(me), tb = me.tball || b, plan = hs.plan || 'hold', shoot = plan === 'shootF' || plan === 'shootU';
    hs.t += DT;
    hs.n = (hs.n || 0) + 1;
    k.z = true;
    const dir = plan === 'pull' ? -s : plan === 'hold' ? 0 : s;
    k.r = dir > 0;
    k.l = dir < 0;
    k.up = shoot ? hs.t < 0.15 && hs.dashT === null && plan === 'shootF' : hs.t < AI_FLOAT_T; // otherwise float (jump held) just after the latch, so we stay up over the ball while the rope drags it about; then come down (the dash only recharges on the ground)
    if (shoot && hs.dashT === null && hs.t >= 0.04 && aiCanDash(me)) { // the dash direction is whatever arrows are held when the key goes down
        k.sp = true;
        k.up = plan === 'shootU';
        k.r = s > 0;
        k.l = s < 0;
        hs.dashT = hs.t;
    }
    if (shoot && hs.n % 2 === 0 && (hs.dashT !== null ? hs.t - hs.dashT > 0.14 : hs.t > 0.4) && aiFlight(tb, me.team))
        k.z = false;                           // it will score: let go
    else if (hs.t > AI_HOLD_MAX && plan !== 'pull' && plan !== 'push')
        k.z = false;                           // could not line it up: give it up
    else if (me.gCharge < 0.15)
        k.z = false;                           // the meter is about to tear it away anyway: let go on our own terms
}
// Keys during an engage jump (before the grapple latches). E = { t, mode: 'toward' | 'none' | 'away' }.
function aiEngageKeys(me, b, E, k) {
    E.t += DT;
    k.up = E.t < AI_JUMP_HOLD;
    const dx = b.x - me.x;
    if (E.mode === 'toward' && Math.abs(dx) > 50)
        k[dx > 0 ? 'r' : 'l'] = true;
    else if (E.mode === 'away' && Math.abs(dx) < 130)
        k[dx > 0 ? 'l' : 'r'] = true;      // too close to latch from here: open the gap while we rise
    if (!me.ground && Math.hypot(dx, b.y - me.y) < me.range + 30) { // (candidates() is the expensive part, so only ask when the ball could be in reach)
        const near = aiNearest(me, b);
        if (near && near.b && !near.decoy)
            k.z = true;                        // the ball is the nearest thing in reach: latch on
    }
}

// ---- look-ahead jobs ----
function aiSimNew(me0) {
    const b = Object.assign(new Ball(), ball), me = aiClone(me0), foes = [];
    if (me.tball)
        me.tball = me.tball === ball ? b : Object.assign(new Ball(), me.tball);
    for (const q of players)                   // an enemy tethered to the ball too (tug of war): their rope matters, keys frozen
        if (q !== me0 && q.team !== me0.team && q.alive && q.onBall && q.tball === ball) {
            const f = aiClone(q);
            f.tball = b;
            foes.push(f);
        }
    return { me, b, foes };
}
function aiSimFork(S) {
    const b = Object.assign(new Ball(), S.b), me = aiClone(S.me);
    if (S.me.tball)
        me.tball = b;
    return { me, b, foes: S.foes.map(f => { const c = aiClone(f); c.tball = b; return c; }) };
}
function aiSimStep(S, k) { // one physics step; returns the scoring team if the ball scored
    Object.assign(S.me.keys, k);
    for (const f of S.foes)
        f.step(S.b);
    S.me.step(S.b);
    return S.b.step();
}
const aiGap = S => Math.hypot(S.me.x - S.b.x, S.me.y - S.b.y);
const aiDead = S => aiGap(S) < S.me.r + S.b.r + 2;

function* aiJumpJob(me0, frozen, delays, modes, out) { // do we latch onto the ball, without touching it, if we jump after one of these delays (in ticks, most likely first)?
    const W = aiSimNew(me0), snaps = {}, asc = [...delays].sort((p, q) => p - q); // the waiting copy: walks on with `frozen` keys for AI_PRE ticks, then stands still
    let n = 0, t = 0;
    for (const d of asc) {                     // one pass to get the state at each delay
        while (t < d) {
            aiSimStep(W, t < AI_PRE ? frozen : aiNoKeys());
            t++;
            if (aiDead(W))
                break;                         // the ball gets us while we wait: later delays are hopeless
            if (++n % AI_SLICE === 0)
                yield;
        }
        if (aiDead(W))
            break;
        snaps[d] = aiSimFork(W);
    }
    for (const d of delays) {                  // then try the most likely one first, and stop at the first that works
        if (!snaps[d])
            continue;
        for (const mode of modes) {
            const V = aiSimFork(snaps[d]), E = { t: 0, mode }, hs = { t: 0, dashT: null, plan: 'hold' };
            let latchedAt = -1, minD = 1e9;
            for (let i = 0; i < AI_JUMP_STEPS; i++) {
                const k = aiNoKeys();
                if (V.me.onBall) {
                    if (latchedAt < 0)
                        latchedAt = i;
                    aiHeldKeys(V.me, V.b, hs, k);
                } else
                    aiEngageKeys(V.me, V.b, E, k);
                aiSimStep(V, k);
                if (aiDead(V))
                    break;
                minD = Math.min(minD, aiGap(V));
                if (latchedAt >= 0 && i - latchedAt >= AI_SAFE_STEPS) {
                    if (minD > 36) {
                        out.ok = true;
                        out.mode = mode;
                        out.delay = d;
                        return;
                    }
                    break;
                }
                if (latchedAt < 0 && V.me.ground && E.t > 0.3)
                    break;                     // landed without latching
                if (++n % AI_SLICE === 0)
                    yield;
            }
        }
    }
}
function* aiHeldJob(me0, hs0, out) { // the best held plan from here (after the ticks this job takes)
    const S = aiSimNew(me0), hs = { ...hs0 }, plans = aiCanDash(me0) ? ['shootU', 'shootF', 'pull', 'push', 'hold'] : ['shootF', 'pull', 'push', 'hold'], s = aiSide(me0), x0 = S.b.x;
    let n = 0;
    for (let i = 0; i < AI_PRE_H; i++) {       // we carry on with the current plan meanwhile
        const k = aiNoKeys();
        aiHeldKeys(S.me, S.b, hs, k);
        aiSimStep(S, k);
        if (aiDead(S) || !S.me.onBall)
            return;
        if (++n % AI_SLICE_H === 0)
            yield;
    }
    let bestV = -Infinity;
    for (const plan of plans) {
        const V = aiSimFork(S), h = { ...hs, plan };
        let minD = 1e9, v = null;
        for (let i = 0; i < AI_HELD_STEPS && v === null; i++) {
            const k = aiNoKeys();
            if (!V.me.onBall) {                // let go: where does it go, and does it then hit us?
                v = (aiFlight(V.b, V.me.team) ? 200 - i * 0.05 : -40) - (aiFlight(V.b, 1 - V.me.team) ? 300 : 0);
                for (let j = 0; j < AI_AFTER_STEPS; j++) {
                    const sc = aiSimStep(V, aiNoKeys());
                    minD = Math.min(minD, aiGap(V));
                    if (aiDead(V)) {
                        v -= 1000;
                        break;
                    }
                    if (sc !== null)
                        break;
                    if (++n % AI_SLICE_H === 0)
                        yield;
                }
                break;
            }
            aiHeldKeys(V.me, V.b, h, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V)) {
                v = -1000 + i;
                break;
            }
            if (sc !== null) {
                v = sc === V.me.team ? 250 : -500;
                break;
            }
            minD = Math.min(minD, aiGap(V));
            if (++n % AI_SLICE_H === 0)
                yield;
        }
        if (v === null) {                      // never let go within the look-ahead
            v = 0;
            const room = (NETX - V.b.x) * s;   // how much room there is between the ball and the net, on our side
            if (plan === 'pull')
                v += room < 110 ? Math.max(0, room) * 0.3 : -40; // worth it only until there is room behind the ball for a shot
            else if (plan === 'push')
                v += room > 150 ? Math.min(45, (V.b.x - x0) * s * 0.12) : -30; // carry it upfield when it is stuck far back
            else if (plan !== 'hold')
                v -= 30;                       // never got to shoot (shootF / shootU)
            if (V.b.vx * s < -60 && (V.b.x - (s > 0 ? 0 : W)) * s < 260)
                v -= 120;                      // heading for our own goal
        }
        if (minD < 44)
            v -= (44 - minD) * 8;
        v += plan === hs0.plan ? 6 : 0;        // keep the current plan unless another is clearly better
        if (v > bestV) {
            bestV = v;
            out.plan = plan;
        }
    }
}
function aiAdvance(A) { // run one slice of the current job
    const fx = snapshotFx();                   // the copies nudge shared effect values: undo that
    const r = A.job.gen.next();
    restoreFx(fx);
    A.job.age++;
    if (r.done)
        A.job.done = true;
}

function aiFree(i, me, A, k) { // keys for an AI that is not tethered
    const s = aiSide(me), b = ball, dx = b.x - me.x, lo = me.team === 0 ? me.r : NETX + me.r, hi = me.team === 0 ? NETX - me.r : W - me.r;
    const mine = (b.x - NETX) * s < 40;        // the ball is on our half (or right at the net)
    if (A.E) {                                 // in an engage jump: carry it out
        aiEngageKeys(me, b, A.E, k);
        if (me.ground && A.E.t > 0.3) {
            A.E = null;
            A.cool = 0.5;                      // landed without latching: breathe
        }
        return;
    }
    if (A.job && A.job.kind === 'jump') {      // a jump look-ahead is running (and maybe a scheduled jump after it)
        const J = A.job;
        Object.assign(k, J.age < AI_PRE ? J.frozen : {}); // what the look-ahead assumed: keep walking for AI_PRE ticks, then stand
        if (!J.done)
            aiAdvance(A);
        else
            J.age++;
        if (J.done && J.age >= AI_PRE) {
            if (!J.out.ok || J.age > J.out.delay + 3) { // nothing works (or we are far too late for it): back to normal
                A.job = null;
                A.jcool = 0.1;
                if (++A.fails % 6 === 0)
                    A.stand = AI_STANDS[(AI_STANDS.indexOf(A.stand) + 1) % AI_STANDS.length]; // standing still and failing: try another distance
            } else if (J.age >= J.out.delay) {
                A.job = null;
                A.jcool = 0.1;
                A.fails = 0;
                if (me.ground) {
                    A.E = { t: 0, mode: J.out.mode };
                    aiEngageKeys(me, b, A.E, k);
                }
            }
        }
        return;
    }
    // a shot coming at us: schedule a jump so that we are up over its path when it arrives
    const grip = aiCanGrip(me), arr = grip && me.ground && A.cool <= 0 && (A.jcool || 0) <= 0 ? aiArrival(me) : null; // (no grip, no grab: with the grapple spent or locked out we only keep clear)
    if (arr && arr.t > 0.3 && arr.t < 1.9) {
        const tj = Math.round(arr.t * 120) - 54, delays = [...new Set([tj, tj - 8, tj + 8, tj - 16, tj + 16, tj - 28].map(d => Math.max(AI_PRE, d)))];
        A.out = {};
        A.job = { kind: 'jump', gen: aiJumpJob(me, aiNoKeys(), delays, ['none'], A.out), out: A.out, frozen: aiNoKeys(), age: 0, done: false };
        return;
    }
    // the approach: run at the ball on the side we are already on, stopping a stand-off short of it (the jump check below picks the moment to go)
    let tx = null;
    if (grip && mine && Math.abs(dx) < 500) {
        const side = me.x >= b.x ? 1 : -1, closing = -side * b.vx;
        tx = Math.max(lo, Math.min(hi, b.x + side * (A.stand || AI_STAND)));
        if (closing > 90 && Math.abs(dx) < 220)
            tx = me.x;                         // it is rolling at us: hold, it will be grabbed or dodged
    } else
        tx = NETX - s * 90;                    // otherwise wait near the net
    const gap = tx - me.x, toward = me.vx * Math.sign(gap);
    if (Math.abs(gap) > 12) {
        const brake = toward > 0 && Math.abs(gap) < toward * 0.5; // too fast to stop in time: back off the throttle
        k.r = gap > 0 !== brake;
        k.l = gap < 0 !== brake;
    }
    A.jcool = Math.max(0, (A.jcool || 0) - DT);
    A.idle = mine && Math.hypot(b.vx, b.vy) < 30 ? (A.idle || 0) + DT : 0; // a resting ball on our half that we are not getting anywhere with:
    if (A.idle > 4) {
        A.idle = 0;
        A.stand = AI_STANDS[(AI_STANDS.indexOf(A.stand) + 1) % AI_STANDS.length]; // come at it from a different distance
    }
    if (grip && mine && me.ground && A.cool <= 0 && A.jcool <= 0 && Math.hypot(dx, b.y - me.y) < 260 && (aiCanDash(me) || me.special !== 'dash')) { // worth asking whether a jump latches
        if (Math.abs(dx) < 66) { k.l = k.r = false; }           // too close to keep running while we think
        A.out = {};
        A.job = { kind: 'jump', gen: aiJumpJob(me, { ...k }, [AI_PRE], ['toward', 'none', 'away'], A.out), out: A.out, frozen: { ...k }, age: 0, done: false };
        return;
    }
    if (Math.hypot(dx, b.y - me.y) < 420 && aiPathMin(me, b, 0, false, lo, hi) < AI_THREAT) { // the ball is going to reach us: pick the steering that keeps us furthest from it
        let best = null, bestD = -1;
        for (const dir of [0, -1, 1])
            for (const up of [false, true]) {
                const d = aiPathMin(me, b, dir, up, lo, hi) + (dir === 0 && !up ? 4 : 0); // (a slight preference for doing nothing)
                if (d > bestD) {
                    bestD = d;
                    best = { dir, up };
                }
            }
        k.l = best.dir < 0;
        k.r = best.dir > 0;
        k.up = best.up;
    }
}
function aiDrive(i) {
    const me = players[i], A = ai[i], k = aiNoKeys();
    A.t -= DT;
    A.cool = Math.max(0, (A.cool || 0) - DT);
    A.noGrab = Math.max(0, A.noGrab - DT);
    if (me.onBall) {
        if (!A.held) {                         // just latched on
            A.held = true;
            A.hs = { t: 0, dashT: null, n: 0, plan: 'hold', next: 0.05 };
            A.E = null;
            A.job = null;
        }
        const hs = A.hs;
        if (me.tball === ball && !A.job && hs.t >= hs.next && hs.dashT === null) { // (re)plan; not once the dash is spent, that plan is committed
            A.out = {};
            A.job = { kind: 'held', gen: aiHeldJob(me, hs, A.out), out: A.out, age: 0, done: false };
        }
        if (A.job && A.job.kind === 'held') {
            aiAdvance(A);
            if (A.job.done && A.job.age >= AI_PRE_H) {
                if (A.job.out.plan)
                    hs.plan = A.job.out.plan;
                hs.next = hs.t + 0.15;
                A.job = null;
            }
        }
        aiHeldKeys(me, ball, hs, k);
        if (me.tball === ball && players.some(q => q.team !== me.team && q.alive && q.onBall && q.tball === ball)) { // tug of war: an enemy has it too
            hs.tug = (hs.tug || 0) + DT;
            if (hs.patience === undefined)
                hs.patience = 0.8 + Math.random() * 1.8; // random, so the two do not give up in lockstep
            if (hs.tug > hs.patience)
                k.z = false;                   // let go; the other one is left holding it and will shoot
        }
    } else {
        if (A.held) {                          // just let go (a throw): do not snatch it straight back
            A.held = false;
            A.hs = null;
            A.job = null;
            A.cool = 1;
            A.t = 0;
        }
        aiFree(i, me, A, k);
    }
    Object.assign(me.keys, k);
}
