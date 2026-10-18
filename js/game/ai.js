// ---- AI opponent: toggle either player with the buttons under the game, or keys 1 (Blue) / 2 (Red) ----
// The AI plays a few simple tactics and leans on the real physics to check them:
//   ENGAGE   walk to a stand-off from the ball, then ask "if I jump right now, do I latch onto the ball and stay clear of it?" by playing that jump forward on a copy of the
//            game; jump the first moment the answer is yes. (The grapple only latches onto the nearest thing, so we have to be airborne and over the ball.)
//            The same check is the DEFENSE: a ball rolling or flying at us gets the same jump-and-grab, which also stops it going into our goal.
//   HOLD     once tethered, play a few plans forward and keep the best one:
//              shootU / shootF  dash toward their goal (up-and-over / flat) so the rope whips the ball along, and let go the moment the ball would end up in their goal
//              pull             run back toward our own side, dragging the ball out of the middle to somewhere with room for a shot
//              push             carry it upfield when it is stuck far back in our own half
//              loopO / loopU    swing the ball around us (over the top / underneath) and let go when a release would score or hit an enemy (the book's osL / usL)
//              hold             hang on
//   CROSS    the ball is slow and between us and our own goal: hop over it (a look-ahead picks a jump that clears it and lands behind it), so the shot can start from behind the ball.
//            ENGAGE then takes over: from behind, a grapple-jump over the ball, latch, and (usually) the HOLD plan 'loopO' swings it up and over for the overhand shot.
//   DODGE    otherwise, if the ball is going to reach us: try each way of steering (left / right / still, jump / not) on a rough model and take the one that keeps us furthest from it.
//   WAIT     far away or ball on their side: wait on the midline of our half (the book's Midline Defense: nothing blocks the grapple circle, and the ball can come from anywhere).
//   RESCUE   (new) a shot that would end up in our goal gets a grab even when the grab is not 'clean': if no jump latches AND stays well clear of the ball, the AI tries ones that only
//            just clear it (a graze), grabs for a short moment to bleed the ball's speed, and lets go. See aiJumpJob's `rescue` search and the RESCUE tunables below.
// The grapple has a meter (4 s of grip, then a 6 s lockout; letting go refills it), so the AI only goes for a grab with enough left, and never holds on for ever.
// Playing things forward costs ~17 us per physics step, so those look-aheads are written as generators and run a few steps per tick (AI_SLICE), never all at once.
// A job first plays forward the ticks it is itself going to take (AI_PRE, keys frozen), so its answer is about the moment it arrives, not the moment it started.
// SIDES: a team does not always defend the left goal: every SIDE_SWAP points the teams trade ends (sidesSwapped, constants.js). Everything below that needs to know where our goal is asks aiLeft(team)
// (never `team === 0`), and the ball reports which SIDE scored (0 = the left team's end), so aiSimStep turns that into a team with sideSwap().
const aiLeft = team => sideSwap(team) === 0;
// ---- tunables for the newer behaviours ----
const AI_LAG = 1;                        // ticks added to a planned jump's start: the real jump starts a tick or two earlier than the plan assumed, and at 800 u/s a tick is ~7 u (tuned: 0 and 2 were worse overall, 3-4 much worse)
const AI_RESCUE = true;                  // false = old behaviour (only 'clean' grabs, otherwise dodge)
const AI_RESCUE_HOLDS = [0.15, 0.35, 0.7]; // how long (s) a rescue grab holds on before letting go: short = just shave the ball's speed, longer = really drag it
const AI_RESCUE_STYLES = [2, 4, 0];      // grapple-jump tap counts the rescue search tries
const AI_RESCUE_AFTER = 120;             // steps played after the release to see whether the ball still gets in
const AI_RESCUE_MARGIN = 1;              // a rescue grab only has to keep this many u clear of touching the ball (the normal search wants a 36 u gap); it must never touch
const AI_DASH_USE = 0.2;                 // chance that a latch is allowed to use the dash shot at all (0 = never dashes, 1 = old behaviour). The rest of the time it shoots with the rope alone.
const AI_THREAT = 50; // dodge when the ball would get this close (u; touching is 30)
const ai = [0, 1, 2, 3].map(() => ({ on: false, plan: null, t: 0, age: 0, noGrab: 0, held: false, rescueHold: null }));
function aiReset(i) { // forget everything it was in the middle of (new round, or switched on / off)
    Object.assign(ai[i], { plan: null, t: 0, age: 0, noGrab: 0, held: false, hs: null, E: null, job: null, cool: 0, jcool: 0, fails: 0, idle: 0, stand: undefined, threat: false, X: null, crossFail: 0, rescueHold: null, airT: 0, airOk: false });
}
// The rollouts step real physics objects, which nudges a few shared effect values (seesaw, hatchet glow, peg flash). Snapshot and restore them.
function snapshotFx() { return { sv: saw.v, st: saw.t, qf: { ...quakeFx }, hp: [...padFlash], pf: pegs.map(q => q.flash) }; }
function restoreFx(s) {
    saw.v = s.sv;
    saw.t = s.st;
    Object.assign(quakeFx, s.qf);
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
    c.casts = (p.casts || []).map(x => ({ ...x })); // (own copies: a shared list would let a look-ahead leave casts on the real player)
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
// Where a ball let go now ends up on the floor, as a distance from OUR goal line (0 = in our goal, W = in theirs). Used to tell a safe toss upfield from dropping it at our feet.
function aiRestFromOwn(b, team) {
    const m = aiLeft(team) ? 1 : -1, dt = 1 / 60, r = BALL_R;
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy, w = b.w || 0;
    for (let n = 0; n < 240; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        { const mgx = -BALL_MAGNUS * w * vy * dt; vy += BALL_MAGNUS * w * vx * dt; vx += mgx; } // spin curves the flight (ball.js): the predictions used to ignore it, so a spinny shot looked like it was going somewhere else
        x += vx * dt;
        y += vy * dt;
        if (y < r) { y = r; if (vy < 0) vy = 0; }
        if (x < 0 || x > W)
            break;
        if (y + r > aiFloorY(x)) {
            y = aiFloorY(x) - r;
            vy = 0;
            vx *= 1 - BALL_ROLL_DRAG * dt;
            if (Math.abs(vx) < 25) break;
        }
    }
    const d = aiLeft(team) ? x : W - x;
    return d;
}
// Letting go of this ball now would end in our goal or leave it rolling close to it.
const aiRisky = (b, me) => aiFlight(b, 1 - me.team) || aiRestFromOwn(b, me.team) < NETX * 0.45;
// The free ball is on course for our goal (or to die right in front of it) if nobody touches it: the cue to grab it even at a graze.
const aiUrgent = me => AI_RESCUE && (aiForecast().end === (aiLeft(me.team) ? -1 : 1) || aiFlight(AIB, 1 - me.team) || aiRestFromOwn(AIB, me.team) < NETX * 0.3);
function aiFlight(b, team) {
    const m = aiLeft(team) ? 1 : -1, dt = 1 / 60, r = BALL_R, roof = GOAL_Y0 + LEDGE_T + r;
    let x = aiLeft(team) ? b.x : W - b.x, y = b.y, vx = b.vx * m, vy = b.vy, w = (b.w || 0) * m; // (mirrored frame: spin flips)
    for (let n = 0; n < AI_FLIGHT_STEPS; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        { const mgx = -BALL_MAGNUS * w * vy * dt; vy += BALL_MAGNUS * w * vx * dt; vx += mgx; } // spin curves the flight (ball.js): the predictions used to ignore it, so a spinny shot looked like it was going somewhere else
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
// ---- aiming zones (from the notes): if the ball is let go now, does it run into an enemy, and how likely is that hit to land? ----
// The Death Ball kills whatever it touches. Enemies are predicted ballistically and never react, so every value is a discount, not a promise.
//   Aerial Point Range  an enemy already in the air can barely steer out of the way: the best hit.
//   Plunge Path Range   a steep ball catches a defender who hops to receive it.
//   Sweep Path Range    a hard ball along the floor traps a grounded defender against it.
// Returns 0 for no hit, else roughly 90..220 (a goal is worth 200 in aiHeldJob). A late hit is worth a little less: they have longer to react.
const AI_HIT_STEPS = 90, AI_HIT_MIN = 110;
function aiBallHit(b, me) {
    const foes = [];
    for (const q of players)
        if (q.team !== me.team && q.alive)
            foes.push({ x: q.x, y: q.y, vx: q.vx, vy: q.vy, r: q.r, air: !q.ground && !q.onBall, g: q.keys && q.keys.up ? G_FLOAT : G });
    if (!foes.length)
        return 0;
    const dt = 1 / 60, r = BALL_R, w = b.w || 0;
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
    for (let n = 0; n < AI_HIT_STEPS; n++) {
        vy += BALL_G * dt;
        vx *= 1 - 0.05 * dt;
        vy *= 1 - 0.05 * dt;
        { const mgx = -BALL_MAGNUS * w * vy * dt; vy += BALL_MAGNUS * w * vx * dt; vx += mgx; } // spin curves the flight (ball.js): the predictions used to ignore it, so a spinny shot looked like it was going somewhere else
        x += vx * dt;
        y += vy * dt;
        if (y < r) { y = r; if (vy < 0) vy = 0; }
        if (x < 0 || x > W)
            return 0;
        const fl = aiFloorY(x) - r;
        let rolling = false;
        if (y >= fl) { y = fl; vy = 0; vx *= 1 - BALL_ROLL_DRAG * dt; rolling = true; if (Math.abs(vx) < 40) return 0; }
        for (const e of foes) {
            if (e.air) {
                e.vy += e.g * dt;
                e.x += e.vx * dt;
                e.y += e.vy * dt;
                const ef = aiFloorY(e.x) - e.r;
                if (e.y >= ef) { e.y = ef; e.vy = 0; e.vx = 0; e.air = false; }
            }
            if (Math.hypot(x - e.x, y - e.y) < r + e.r) {
                let v = e.air ? 150 : 90;
                if (vy > 0.8 * Math.abs(vx))
                    v += 30;                   // steep
                else if (rolling && !e.air && Math.abs(vx) > 300)
                    v += 40;                   // hard and low against a grounded enemy
                return v - n * 0.4;
            }
        }
    }
    return 0;
}

// The closest we and the free ball get over the next 0.6 s if we hold this steering (dir -1/0/1, up = jump / float). Both move ballistically (cheap and rough): this is what
// lets the AI see that it is about to fall onto a ball lying on the floor, or that a rolling ball will reach it, and pick the way out.
function aiPathMin(me, b, dir, up, lo, hi) {
    let x = me.x, y = me.y, vx = me.vx, vy = me.vy, grounded = me.ground, bx = b.x, by = b.y, bvx = b.vx, bvy = b.vy, bw = b.w || 0, min = 1e9;
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
        { const mgx = -BALL_MAGNUS * bw * bvy * dt; bvy += BALL_MAGNUS * bw * bvx * dt; bvx += mgx; } // spin
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
// ---- which body are we thinking about? ----
// There can be several balls on the field: the death ball and any decoys. A decoy scores like the death ball but never kills. Every prediction and look-ahead below works on ONE body, AIB:
// the one we are tethered to, else the one that will reach our goal soonest, else (if the death ball is not on our half) the nearest decoy on our half, else the death ball. The death ball is the only
// thing that can kill us, so the dodge always watches it, whatever AIB is.
const AI_DECOYS = true;                    // false = decoys are ignored, like before
const AI_RACE = true;                      // the Shot Race: while holding a ball, weigh our shot against another ball about to score on us (false = ignore the other ball, like before)
const AI_RACE_MARGIN = 4;                  // ticks: our shot has to land at least this long before their ball does to count as winning the race
const AI_DEFEND_LEAD = 40;                 // ticks (~0.33 s) it takes us, once free, to react and jump to a ball coming at our goal
let AIB = ball;
function aiPickFocus(me, A) {
    if (me.onBall && me.tball)
        return me.tball;
    if ((A.job || A.E || A.X) && A.fb && (A.fb === ball || decoys.includes(A.fb)))
        return A.fb;                       // a look-ahead / jump in progress was planned for this body: keep it
    let best = ball;
    if (AI_DECOYS && decoys.length) {
        const goal = aiLeft(me.team) ? -1 : 1, s = aiSide(me);
        let bt = Infinity, threat = null;
        for (const b of [ball, ...decoys]) {
            const f = aiForecast(b);
            if (f.end === goal && f.path.length < bt) {
                bt = f.path.length;
                threat = b;
            }
        }
        if (threat)
            best = threat;                 // whatever will score on us first is the business at hand
        else if ((ball.x - NETX) * s >= 40) { // the death ball is not on our half: a decoy that is, is a chance
            let bd = Infinity;
            for (const d of decoys)
                if ((d.x - NETX) * s < 40 && Math.hypot(d.x - me.x, d.y - me.y) < bd) {
                    bd = Math.hypot(d.x - me.x, d.y - me.y);
                    best = d;
                }
        }
    }
    return best;
}

// ---- the Shot Race ----
// The earliest OTHER body (not the one we hold) that will score on us if nobody touches it: { T: ticks from now, at(t): where it is t ticks from now }, or null.
function aiOtherThreat(me) {
    const goal = aiLeft(me.team) ? -1 : 1, sd = aiSide(me);
    let best = null;
    for (const b of [ball, ...decoys]) {
        if (b === me.tball)
            continue;
        const f = aiForecast(b), off = aiTickN - f.stamp, T = f.path.length - off;
        if (f.end !== goal || T <= 0 || (best && T >= best.T))
            continue;
        let D = 0;                             // ticks until it gets past us (within 50 u of our x): after that it is out of our reach, so that is our real deadline, not the goal
        while (D < f.path.length && (f.path[D].x - me.x) * sd >= 50)
            D++;
        D = Math.max(0, D - off);
        if (D === 0)
            D = T;                             // already past us (between us and our goal): we can only chase it, and the deadline is when it scores
        best = { T, D, at: t => f.path[Math.max(0, Math.min(f.path.length - 1, t + off - 1))] };
    }
    return best;
}
// Free from tick `relT` on, standing at x, can we still get to the threat before it scores? (we need AI_DEFEND_LEAD ticks to react and jump, and can run ~250 u/s on the way)
function aiCanReceive(R, x, relT) {
    const spare = R.D - AI_DEFEND_LEAD - relT;
    if (spare <= 0)
        return false;
    const p = R.at(R.D - AI_DEFEND_LEAD);
    return Math.abs(p.x - x) < 250 * spare * DT + RANGE * 0.8;
}
// Uncached: if this body is left alone, does it score, and in how many ticks? { end: -1 / 0 / +1, steps }
function aiRollEnd(body) {
    const b = Object.assign(new Ball(), body);
    for (let i = 0; i < AI_FC_STEPS; i++) {
        const sc = b.step();
        if (sc !== null || aiInGoal(b))
            return { end: b.x < W / 2 ? -1 : 1, steps: i + 1 };
    }
    return { end: 0, steps: Infinity };
}

// ---- the free ball's future, by the REAL ball physics ----
// The hand-written predictors above (aiArrival, aiFlight ...) are quick but they leave things out: how a spinning ball grips the floor, the jut, the slopes, pegs. For the question "is this shot
// coming at my goal, and when does it get here" the AI therefore steps a copy of the real ball forward (nobody touching it) and reads the answer off that. Shared by all AIs, and redone only
// every few ticks (or when the ball is hit / bounces off its predicted path).
// Inside a goal mouth (past the line, between the posts): it will score, so the forecast calls it a goal as soon as that happens (the real score only comes when it has rolled to the back of the alcove).
const aiInGoal = b => (b.x < -8 || b.x > W + 8) && b.y > GOAL_Y0 && b.y < GOAL_Y1;
const AI_FC_STEPS = 300, AI_FC_EVERY = 6;
let aiTickN = 0, aiLastI = 99;
const aiFcMap = new Map();                 // body -> its forecast (the death ball and every decoy get one)
function aiForecast(body = AIB) {
    let f = aiFcMap.get(body);
    if (f && f.stamp === aiTickN)
        return f;
    if (f && aiTickN - f.stamp < AI_FC_EVERY) {
        const q = f.path[Math.min(aiTickN - f.stamp - 1, f.path.length - 1)];
        if (q && Math.hypot(q.vx - body.vx, q.vy - body.vy) < 25 && Math.hypot(q.x - body.x, q.y - body.y) < 12)
            return f;                          // still on the predicted path
    }
    const b = Object.assign(new Ball(), body), path = [];
    let end = 0;                               // -1 = into the left goal, +1 = into the right goal, 0 = neither within the look-ahead
    for (let i = 0; i < AI_FC_STEPS; i++) {
        const sc = b.step();
        path.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy });
        if (sc !== null || aiInGoal(b)) {
            end = b.x < W / 2 ? -1 : 1;
            break;
        }
    }
    f = { stamp: aiTickN, path, end };
    if (aiFcMap.size > 8)
        for (const k of aiFcMap.keys())
            if (k !== ball && !decoys.includes(k))
                aiFcMap.delete(k);             // forget bodies that are gone
    aiFcMap.set(body, f);
    return f;
}
function aiArrival(me) {
    const s = aiSide(me);
    if (AIB.vx * s > -90 || (AIB.x - me.x) * s < 0)
        return null;                           // not coming at us (or already past)
    const path = aiForecast().path;
    for (let n = 0; n < path.length; n++)
        if ((path[n].x - me.x) * s < 50)
            return { t: (n + 1) * DT, y: path[n].y };
    return null;
}

// The steering that keeps us furthest from the free ball over the next 0.6 s, or null if it is not going to reach us (the DODGE tactic, shared with the held-plan look-ahead below so that a plan that
// lets go of the ball is judged with the dodge the AI will really do afterwards, not as if it stood frozen).
function aiDodge(me, b, lo, hi) {
    if (Math.hypot(b.x - me.x, b.y - me.y) > 420 || aiPathMin(me, b, 0, false, lo, hi) >= AI_THREAT)
        return null;
    let best = null, bestD = -1;
    for (const dir of [0, -1, 1])
        for (const up of [false, true]) {
            const d = aiPathMin(me, b, dir, up, lo, hi) + (dir === 0 && !up ? 4 : 0); // (a slight preference for doing nothing)
            if (d > bestD) {
                bestD = d;
                best = { dir, up };
            }
        }
    return best;
}

// Would grabbing the ball RIGHT NOW (from the air) and then holding it be survivable? One rollout, like a trial in the jump search: latch next tick, then the 'hold' plan.
function aiAirGrabSafe(me) {
    const V = aiSimNew(me), hs = { t: 0, dashT: null, plan: 'hold' };
    let latched = false;
    for (let i = 0; i < AI_SAFE_STEPS; i++) {
        const k = aiNoKeys();
        if (V.me.onBall) {
            latched = true;
            aiHeldKeys(V.me, V.b, hs, k);
        } else
            k.z = true;
        if (aiSimStep(V, k) !== null || aiDead(V))
            return false;
        if (i === 3 && !latched)
            return false;                      // the press did not take the ball (something else was nearer)
    }
    return latched;
}

// ---- tactics ----
const AI_GRIP_MIN = 1.6, AI_FLOAT_T = 0.8, AI_JUMP_HOLD = 0.6, AI_STAND = 90, AI_STANDS = [90, 130, 70, 160, 110], AI_HOLD_MAX = 1.6;
const AI_SLICE = 96, AI_PRE = 8;          // jump jobs: physics steps per tick, and the ticks of latency they plan around
const AI_SLICE_H = 48, AI_PRE_H = 24;      // held-plan jobs: bigger, because they must finish within their latency window (AI_PRE_H ticks) to be about the moment they land
const AI_JUMP_STEPS = 180, AI_SAFE_STEPS = 84, AI_HELD_STEPS = 96, AI_AFTER_STEPS = 72, AI_LOOP_STEPS = 180, AI_LOOP_MAX = 2.4, AI_STALL_MAX = 2.2; // look-ahead lengths (steps): a jump, the safe time after latching, a held plan, the time after a release
const AI_WAIT_FRAC = 0.5; // where the AI waits when the ball is not its business: 0 = against the net, 0.5 = the midline of its half (the book's Midline Defense), 1 = at its goal. (The old spot was 90 u from the net, about 0.19.)
const aiMid = me => NETX - aiSide(me) * AI_WAIT_FRAC * NETX;
// Grapple-jump launches: tap the grapple on the floor with weight held (weight multiplies the kick, and each tap within 1.5 s of the last makes the next one stronger and adds to our
// upward speed), then fly up with jump held. n taps reach higher, faster, than a plain jump; the look-ahead decides which n works.
const AI_TAP_T = 0.17, AI_TAP_ON = 0.13; // one tap every 0.17 s, the grapple down for 0.13 s (the hook needs 0.1 s to land)
const aiSide = me => (aiLeft(me.team) ? 1 : -1); // +1: we defend the left goal and attack to the right
const aiNoKeys = () => ({ l: false, r: false, up: false, dn: false, z: false, x: false, sp: false, sp2: false });
const aiNearest = (me, b) => me.candidates(me.sim ? b : ball).reduce((m, o) => (!m || o.d < m.d ? o : m), null); // (a planning copy only knows the body it plans with; the real game also offers the death ball and every decoy)
const aiCanDash = (me, hs) => me.special === 'dash' && me.dashReady && me.cd.dash <= 0 && !(hs && hs.noDash); // hs.noDash: this latch shoots with the rope only
const aiCanGrip = me => me.gCool <= 0 && me.gCharge > AI_GRIP_MIN; // the grapple meter: enough left to latch on and do something with it

// Keys for a tethered AI. hs = { t: seconds since the latch, plan, dashT: when we dashed (or null), n: tick counter }.
function aiHeldKeys(me, b, hs, k) {
    const s = aiSide(me), tb = me.tball || b, plan = hs.plan || 'hold', dashPlan = plan === 'shootF' || plan === 'shootU', shoot = dashPlan || plan === 'sling' || plan === 'slingU', loop = plan === 'loopO' || plan === 'loopU';
    hs.t += DT;
    hs.n = (hs.n || 0) + 1;
    k.z = plan !== 'drop';                     // 'drop' = let go right now (the ball is about to get us)
    const dir = plan === 'pull' ? -s : plan === 'hold' ? 0 : s;
    k.r = dir > 0;
    k.l = dir < 0;
    k.up = shoot ? (plan === 'sling' ? hs.t < 0.5 : plan === 'slingU' ? hs.t < 0.9 : hs.t < 0.15 && hs.dashT === null && plan === 'shootF') : hs.t < AI_FLOAT_T; // otherwise float (jump held) just after the latch, so we stay up over the ball while the rope drags it about; then come down (the dash only recharges on the ground)
    if (loop) { // orbit the ball: keep moving along the circle we are on (osL = over the top, usL = underneath), floating whenever the circle is going up
        const rx = me.x - tb.x, ry = me.y - tb.y, d = Math.hypot(rx, ry) || 1, sp = plan === 'loopO' ? s : -s;
        const tx = sp * -ry / d, ty = sp * rx / d; // unit tangent: which way we have to move to keep going round
        k.r = tx > 0.3;
        k.l = tx < -0.3;
        k.up = ty < 0.3;
    }
    if (dashPlan && hs.dashT === null && hs.t >= 0.04 && aiCanDash(me, hs)) { // the dash direction is whatever arrows are held when the key goes down
        k.sp = true;
        k.up = plan === 'shootU';
        k.r = s > 0;
        k.l = s < 0;
        hs.dashT = hs.t;
    }
    if ((shoot || loop) && hs.n % 2 === 0 && (hs.dashT !== null ? hs.t - hs.dashT > 0.14 : hs.t > (loop ? 0.35 : 0.4)) && (aiFlight(tb, me.team) || aiBallHit(tb, me) >= AI_HIT_MIN))
        k.z = false;                           // it will score (or hit an enemy that cannot get out of the way): let go
    else if (hs.t > (loop ? AI_LOOP_MAX : AI_HOLD_MAX) && plan !== 'pull' && plan !== 'push' && !aiRisky(tb, me))
        k.z = false;                           // could not line it up: give it up (but never into a bad spot: only a meter about to run out lets go of a ball that would end up in or near our goal)
    else if (hs.t > AI_STALL_MAX && plan === 'push' && !aiRisky(tb, me))
        k.z = false;                           // carried it as far as it goes: toss it
    else if (me.gCharge < 0.15)
        k.z = false;                           // the meter is about to tear it away anyway: let go on our own terms
    if (hs.rescue !== undefined && hs.t > hs.rescue && !aiRisky(tb, me))
        k.z = false;                           // a rescue grab: it only had to bleed off the ball's speed. (Only let go if the ball is then somewhere safe: a slow ball left rolling towards our goal is just a goal a moment later; the normal plans take over instead.)
}
// Keys during an engage jump (before the grapple latches). E = { t, mode: 'toward' | 'none' | 'away' }.
function aiEngageKeys(me, b, E, k) {
    E.t += DT;
    const taps = E.taps || 0;
    k.up = E.t < Math.max(AI_JUMP_HOLD, taps * AI_TAP_T + 0.35);
    if (taps) {
        const i = Math.floor(E.t / AI_TAP_T);
        k.z = i < taps && E.t - i * AI_TAP_T < AI_TAP_ON;
        k.x = E.t < taps * AI_TAP_T;         // weighted kicks
    }
    const dx = b.x - me.x;
    if (E.mode === 'toward' && Math.abs(dx) > 50)
        k[dx > 0 ? 'r' : 'l'] = true;
    else if (E.mode === 'away' && Math.abs(dx) < 130)
        k[dx > 0 ? 'l' : 'r'] = true;      // too close to latch from here: open the gap while we rise
    if (!me.ground && Math.hypot(dx, b.y - me.y) < RANGE + 30) { // (candidates() is the expensive part, so only ask when the ball could be in reach)
        const near = aiNearest(me, b);
        if (near && near.b && near.ball === b) // the body we are after is the nearest thing in reach: latch on.
            k.z = !((me.rope || me.pending) && !me.onBall); // (A held grapple never re-targets: if the tap jump left us hooked to the floor, let go for a tick so the next press takes the ball. Before this, a ball that arrived while we hung on a floor rope flew past un-grabbed.)
    }
}

// ---- crossing: hop over a slow ball that is behind us, so the shot can start from behind it ----
// Our overhand shot starts BEHIND the ball (the side nearer our own goal): jump over it, grapple it as we go, swing it up and over and let go toward their goal. When the ball is between us and
// our own goal we first have to get round it. The only way past a ball that kills on touch is over it, so: jump, drift toward our own goal, land behind it. aiCrossJob plays that forward on a
// copy of the game with a few jump lengths and only commits to one that never touches the ball and lands clear of it.
const AI_CROSS_HOLDS = [0.7, 1.1, 1.6], AI_CROSS_CLEAR = 40, AI_CROSS_ROOM = 150; // how long the jump key is held (s), and how far behind the ball we must land (u)
function aiCrossKeys(me, X, k) {
    X.t += DT;
    k.up = X.t < X.hold;
    k[aiSide(me) > 0 ? 'l' : 'r'] = true;   // toward our own goal
}
function* aiCrossJob(me0, frozen, out) {
    const S = aiSimNew(me0), s = aiSide(me0);
    let n = 0;
    for (let i = 0; i < AI_PRE; i++) {         // the real AI carries on with `frozen` while this runs
        aiSimStep(S, frozen);
        if (aiDead(S))
            return;
    }
    for (const hold of AI_CROSS_HOLDS) {
        const V = aiSimFork(S), X = { t: 0, hold };
        let minD = 1e9;
        for (let i = 0; i < 300; i++) {
            const k = aiNoKeys();
            aiCrossKeys(V.me, X, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V) || (sc !== null && sc !== V.me.team))
                break;                         // it got us, or it went in our goal anyway
            minD = Math.min(minD, aiGap(V));
            if (V.me.ground && X.t > 0.3) {
                if (minD > 34 && (V.me.x - V.b.x) * s < -AI_CROSS_CLEAR) {
                    out.ok = true;
                    out.hold = hold;
                    return;
                }
                break;                         // landed in the wrong place
            }
            if (++n % AI_SLICE === 0)
                yield;
        }
    }
}

// ---- look-ahead jobs ----
function aiSimNew(me0) {
    const b = Object.assign(new Ball(), AIB), me = aiClone(me0), foes = [];
    if (me.tball)
        me.tball = me.tball === AIB ? b : Object.assign(new Ball(), me.tball);
    for (const q of players)                   // an enemy tethered to the ball too (tug of war): their rope matters, keys frozen
        if (q !== me0 && q.team !== me0.team && q.alive && q.onBall && q.tball === AIB) {
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
    const sc = S.b.step(); // the SIDE that scored (0 = the left team's end), not the team: after a side swap they differ
    return sc === null ? null : sideSwap(sc);
}
const aiGap = S => Math.hypot(S.me.x - S.b.x, S.me.y - S.b.y);
const aiDead = S => aiGap(S) < S.me.r + S.b.r + 2;

function* aiJumpJob(me0, frozen, delays, modes, out, styles = [0], robust = false, rescue = false) { // do we latch onto the ball, without touching it, if we jump after one of these delays (in ticks, most likely first)?
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
    // One rollout: if we jump from `snap` with this steering and tap count, do we latch onto the ball and stay clear of it? jx / jv nudge the start (position / speed): the real jump never starts
    // exactly where the plan assumed (a tick or two of lag), and a latch is often a knife edge (the grapple takes whatever is nearest, and the ball only just beats the floor), so a jump
    // is trusted (when `robust`) only if it also works from a slightly different start.
    const trial = function* (snap, mode, taps, jx, jv) {
        const V = aiSimFork(snap), E = { t: 0, mode, taps }, hs = { t: 0, dashT: null, plan: 'hold' };
        V.me.x += jx;
        V.me.vx += jv;
        let latchedAt = -1, minD = 1e9, prevGap = 1e9;
        for (let i = 0; i < AI_JUMP_STEPS; i++) {
            const k = aiNoKeys();
            if (V.me.onBall) {
                if (latchedAt < 0)
                    latchedAt = i;
                aiHeldKeys(V.me, V.b, hs, k);
            } else
                aiEngageKeys(V.me, V.b, E, k);
            const sc = aiSimStep(V, k);
            if (aiDead(V) || (sc !== null && sc !== V.me.team))
                return false;                  // it got us, or it went in our goal anyway
            const gap = aiGap(V);
            minD = Math.min(minD, gap);
            if (latchedAt < 0 && !V.me.ground && gap > RANGE + 30 && gap > prevGap)
                return false;                  // out of reach and still drifting apart (a tap jump that has shot past the ball): it cannot latch any more, so stop here and let the search move on.
                                               // Without this every failed candidate ran the whole look-ahead, the job finished after the moment it was planning for, and the AI fell back to a dodge hop.
            prevGap = gap;
            if (latchedAt >= 0 && i - latchedAt >= AI_SAFE_STEPS)
                return minD > 36 && !aiFlight(V.b, 1 - V.me.team);
            if (latchedAt < 0 && V.me.ground && E.t > 0.3)
                return false;                  // landed without latching
            if (++n % AI_SLICE === 0)
                yield;
        }
        return false;
    };
    // ---- RESCUE rollouts (tried per delay, right after the clean ones fail: nothing 'clean' latches, but the ball is on course for our goal. Accept a grab that only just clears the ball (a graze), holds a moment to bleed its speed, then lets go.
    // Score of a rollout: 1000 = we live and the ball does NOT end up in our goal; otherwise minus the ball's speed toward our goal when it gets there (a slowed ball is still better: it gives the
    // hatchet, the ramp or a teammate time to deal with it); -Infinity = we never latched, or the ball killed us.
    const s = aiSide(me0), rtrial = function* (snap, mode, taps, hold) {
        const V = aiSimFork(snap), E = { t: 0, mode, taps }, hs = { t: 0, dashT: null, plan: 'hold', rescue: hold };
        let latched = false, since = 0, prevGap = 1e9;
        const soft = () => -Math.max(0, -V.b.vx * s);
        for (let i = 0; i < AI_JUMP_STEPS + AI_RESCUE_AFTER + 60; i++) {
            const k = aiNoKeys();
            if (V.me.onBall) {
                latched = true;
                aiHeldKeys(V.me, V.b, hs, k);
            } else if (!latched)
                aiEngageKeys(V.me, V.b, E, k);
            const sc = aiSimStep(V, k);
            const gap = aiGap(V);
            if (gap < V.me.r + V.b.r + AI_RESCUE_MARGIN)
                return -Infinity;              // it still must not touch us
            if (sc !== null)
                return sc === V.me.team ? 1000 : latched ? soft() : -Infinity;
            if (!latched && !V.me.ground && gap > RANGE + 30 && gap > prevGap)
                return -Infinity;              // out of reach and drifting apart
            prevGap = gap;
            if (!latched && V.me.ground && E.t > 0.3)
                return -Infinity;              // landed without latching
            if (latched && V.me.onBall && hs.t > hold && aiRisky(V.b, V.me))
                return soft() - 100;           // slowed it but it would still end up in / near our goal if we let go: worth grabbing, and the normal plans carry on from there
            if (latched && !V.me.onBall && ++since >= AI_RESCUE_AFTER)
                return aiRisky(V.b, V.me) ? soft() - 100 : 1000;
            if (++n % AI_SLICE === 0)
                yield;
        }
        return -Infinity;
    };
    let best = null;
    for (const d of delays) {                  // then try the most likely one first, and stop at the first that works
        if (!snaps[d] || d < (out.now || 0) + 2)
            continue;
        for (const taps of styles) for (const mode of modes) {
            if (!(yield* trial(snaps[d], mode, taps, 0, 0)))
                continue;
            if (robust && (!(yield* trial(snaps[d], mode, taps, 5, 30)) || !(yield* trial(snaps[d], mode, taps, -5, -30))))
                continue;                      // a knife edge: not good enough (only asked of a calm approach: against an incoming shot a marginal jump beats none)
            out.ok = true;
            out.mode = mode;
            out.taps = taps;
            out.delay = d;
            return;
        }
        if (!rescue)
            continue;
        // No clean jump at this delay. Try the rescue grabs for the SAME delay before moving to a later one: the clean search is slow, and by the time it has run through every delay the early,
        // useful ones are in the past (the ball is already on us).
        for (const taps of AI_RESCUE_STYLES) for (const mode of modes) for (const hold of AI_RESCUE_HOLDS) {
            if (d < (out.now || 0) + 2)
                break;
            const sc = yield* rtrial(snaps[d], mode, taps, hold);
            if (sc >= 1000) {
                Object.assign(out, { ok: true, mode, taps, delay: d, rescue: hold });
                return;
            }
            if (sc > -Infinity && (!best || sc > best.sc))
                best = { sc, mode, taps, delay: d, rescue: hold };
        }
    }
    if (best && best.delay >= (out.now || 0) + 2)  // nothing saves it outright, but a grab that slows it beats a dodge
        Object.assign(out, { ok: true, mode: best.mode, taps: best.taps, delay: best.delay, rescue: best.rescue });
}
function* aiHeldJob(me0, hs0, out) { // the best held plan from here (after the ticks this job takes)
    const S = aiSimNew(me0), hs = { ...hs0 }, plans = aiCanDash(me0, hs0) ? ['shootU', 'shootF', 'sling', 'loopO', 'loopU', 'pull', 'push', 'hold', 'drop'] : ['sling', 'loopO', 'loopU', 'pull', 'push', 'hold', 'drop'], s = aiSide(me0), x0 = S.b.x;
    let n = 0;
    const R = out.race || null, atk = aiLeft(me0.team) ? 1 : -1; // R: another body about to score on us (see aiOtherThreat); atk: the goal we attack
    for (let i = 0; i < AI_PRE_H; i++) {       // we carry on with the current plan meanwhile
        const k = aiNoKeys();
        aiHeldKeys(S.me, S.b, hs, k);
        aiSimStep(S, k);
        if (aiDead(S)) {                       // the current plan gets us before a new one could take over: let go of it now, and hope
            out.plan = 'drop';
            return;
        }
        if (!S.me.onBall)
            return;
        if (++n % AI_SLICE_H === 0)
            yield;
    }
    let bestV = -Infinity;
    for (const plan of plans) {
        const V = aiSimFork(S), h = { ...hs, plan };
        let minD = 1e9, v = null, relT = Infinity, scoreT = Infinity, relX = 0, dead = false;
        const steps = plan === 'loopO' || plan === 'loopU' ? AI_LOOP_STEPS : AI_HELD_STEPS; // a loop needs time to come round
        for (let i = 0; i < steps && v === null; i++) {
            const k = aiNoKeys();
            if (!V.me.onBall) {                // let go: where does it go, and does it then hit us?
                relT = AI_PRE_H + i;
                relX = V.me.x;
                const rest = aiRestFromOwn(V.b, V.me.team);   // a toss that ends up upfield is a fine thing to do with a ball we cannot score with; dropping it near our own goal is not
                const restV = rest > NETX + 40 ? 30 : rest > NETX * 0.6 ? 0 : -60 * (1 - rest / (NETX * 0.6));
                v = Math.max(aiFlight(V.b, V.me.team) ? 200 - i * 0.05 : -40 + restV, aiBallHit(V.b, V.me) - 40) - (aiFlight(V.b, 1 - V.me.team) ? 300 : 0);
                let dk = null;
                for (let j = 0; j < AI_AFTER_STEPS; j++) {
                    if (j % 8 === 0) {                 // after letting go the AI dodges (see aiFree): judge the release with that, not with the AI standing frozen
                        dk = Math.hypot(V.b.x - V.me.x, V.b.y - V.me.y) < 170 ? aiDodge(V.me, V.b, V.me.r, W - V.me.r) : null;
                        n += 6;                        // (that look-ahead is not free: count it against the slice)
                    }
                    const kk = aiNoKeys();
                    if (dk) {
                        kk.l = dk.dir < 0;
                        kk.r = dk.dir > 0;
                        kk.up = dk.up;
                    }
                    const sc = aiSimStep(V, kk);
                    minD = Math.min(minD, aiGap(V));
                    if (aiDead(V)) {
                        v -= 1000;
                        dead = true;
                        break;
                    }
                    if (sc !== null) {
                        if (sc === V.me.team)
                            scoreT = relT + j + 1;
                        break;
                    }
                    if (++n % AI_SLICE_H === 0)
                        yield;
                }
                if (R && !dead && scoreT === Infinity) { // did not score inside the look-ahead: does it still, later? (only worth knowing in a race)
                    const e = aiRollEnd(V.b);
                    if (e.end === atk)
                        scoreT = relT + AI_AFTER_STEPS + e.steps;
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
                if (sc === V.me.team)
                    scoreT = AI_PRE_H + i + 1;
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
                v -= 30;                       // never got to shoot (shootF / shootU / loops)
            if (V.b.vx * s < -60 && (V.b.x - (s > 0 ? 0 : W)) * s < 260)
                v -= 120;                      // heading for our own goal
        }
        if (R) {                               // THE SHOT RACE: another body is about to score on us
            if (relT < Infinity) {             // this plan lets go at relT
                const rec = aiCanReceive(R, relX, relT);
                if (scoreT + AI_RACE_MARGIN < R.T)
                    v += 100 + (rec ? 60 : 0); // our shot lands first: go for it (best of all if we can still pick up the receive)
                else
                    v = rec ? Math.min(v, -10) - relT * 0.05 : v - 400; // our shot is too slow: it is worth nothing now; what counts is being free in time to deal with theirs
            } else if (AI_PRE_H + steps >= R.D - AI_DEFEND_LEAD)
                v -= 400;                      // still holding on when their ball arrives: it scores while we are tied up
            out.race = true;
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
    A.job.out.now = A.job.age;                 // (the job skips jump delays that are already in the past by the time it gets to them)
    const r = A.job.gen.next();
    restoreFx(fx);
    A.job.age++;
    if (r.done)
        A.job.done = true;
}

function aiFree(i, me, A, k) { // keys for an AI that is not tethered
    const s = aiSide(me), b = AIB, dx = b.x - me.x, away = (me.x - NETX) * s > 0; // away: we are over the net, on their half (a dash shot carries us there)
    const left = aiLeft(me.team), lo = left || away ? me.r : NETX + me.r, hi = left && !away ? NETX - me.r : W - me.r; // the room to dodge in: our half, or the whole arena when we are on theirs (the dodge model clamps to it, so a clamp to the wrong half 'teleports' us to the net and hides the ball)
    const mine = (b.x - NETX) * s < 40;        // the ball is on our half (or right at the net)
    if (A.E) {                                 // in an engage jump: carry it out
        aiEngageKeys(me, b, A.E, k);
        if (me.ground && A.E.t > 0.3) {
            A.E = null;
            A.rescueHold = null;
            A.cool = 0.5;                      // landed without latching: breathe
        }
        return;
    }
    if (A.X) {                                 // hopping over the ball: carry it out
        aiCrossKeys(me, A.X, k);
        if (me.ground && A.X.t > 0.3) {
            A.X = null;
            A.cool = 0.3;
        }
        return;
    }
    if (A.job && A.job.kind === 'cross') {     // a cross look-ahead is running
        const J = A.job;
        Object.assign(k, J.age < AI_PRE ? J.frozen : {});
        if (!J.done)
            aiAdvance(A);
        else
            J.age++;
        if (J.done && J.age >= AI_PRE) {
            A.job = null;
            if (J.out.ok) {
                A.crossFail = 0;
                A.X = { t: 0, hold: J.out.hold };
                aiCrossKeys(me, A.X, k);
            } else {
                A.jcool = 0.15;
                A.crossFail++;
            }
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
            } else if (J.age >= J.out.delay + AI_LAG) {
                A.job = null;
                A.jcool = 0.1;
                A.fails = 0;
                if (me.ground) {
                    A.rescueHold = J.out.rescue !== undefined ? J.out.rescue : null; // a rescue grab lets go early (see aiHeldKeys)
                    A.E = { t: 0, mode: J.out.mode, taps: J.out.taps || 0 };
                    aiEngageKeys(me, b, A.E, k);
                }
            }
        }
        return;
    }
    // a shot coming at us: schedule a jump so that we are up over its path when it arrives
    const grip = aiCanGrip(me), arr = grip && me.ground && (A.cool <= 0 || b !== A.heldBody) && (A.jcool || 0) <= 0 ? aiArrival(me) : null; // (the sulking cooldown after a throw only applies to the body we just threw) // (no grip, no grab: with the grapple spent or locked out we only keep clear)
    const urgent = arr ? aiUrgent(me) : false; // a shot at our goal is worth a try even when it is nearly on us (a rescue grab only needs ~0.1 s of warning); otherwise a jump needs 0.3 s
    if (arr && arr.t > (urgent ? 0.1 : 0.3) && arr.t < 1.9) {
        // launch as early as the reaction time allows, then later: the look-ahead takes the first (earliest) one that latches the ball and holds it. 2 or 4 grapple-jump taps are the usual winners;
        // fast, high shots need the taps, slow ones a plain jump.
        const last = Math.round(arr.t * 120) + 6, delays = [...new Set([0, 6, 14, 24, 36, 50, 66].map(d => Math.max(AI_PRE, AI_PRE + d)).filter(d => d <= last))];
        if (!delays.length) delays.push(AI_PRE);
        A.out = {};
        A.job = { kind: 'jump', gen: aiJumpJob(me, aiNoKeys(), delays, ['toward', 'none'], A.out, [2, 4, 0, 3, 6], false, urgent), out: A.out, frozen: aiNoKeys(), age: 0, done: false };
        return;
    }
    // the ball is behind us (between us and our own goal), slow and low: get round it first (see aiCrossJob). If crossing keeps failing, the normal approach below takes over.
    const behind = mine && (me.x - b.x) * s > 25 && Math.hypot(b.vx, b.vy) < 220 && b.y > aiFloorY(b.x) - 70 && (s > 0 ? b.x : W - b.x) > AI_CROSS_ROOM; // (and enough room between the ball and our goal to land and shoot from there)
    if (!behind)
        A.crossFail = 0;
    if (grip && behind && me.ground && A.crossFail < 3 && A.cool <= 0 && (A.jcool || 0) <= 0 && Math.abs(dx) < 190 && Math.abs(dx) > 55) {
        A.out = {};
        A.job = { kind: 'cross', gen: aiCrossJob(me, aiNoKeys(), A.out), out: A.out, frozen: aiNoKeys(), age: 0, done: false };
        return;
    }
    // the approach: run at the ball on the side we are already on, stopping a stand-off short of it (the jump check below picks the moment to go)
    let tx = null;
    if (grip && mine && Math.abs(dx) < 500) {
        const side = me.x >= b.x ? 1 : -1, closing = -side * b.vx;
        const slow = Math.hypot(b.vx, b.vy) < 150 && me.ground; // a ball creeping along our floor (maybe towards our own goal): go right up to it and hop over it, do not hover at a safe stand-off while it trickles in
        tx = Math.max(lo, Math.min(hi, b.x + side * (slow ? 45 : (A.stand || AI_STAND))));
        if (closing > 90 && Math.abs(dx) < 220)
            tx = me.x;                         // it is rolling at us: hold, it will be grabbed or dodged
    } else
        tx = aiMid(me);                        // otherwise wait on the midline of our half (Midline Defense), not up against the net (Quell Rank Range)
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
    if (grip && mine && me.ground && A.cool <= 0 && A.jcool <= 0 && Math.hypot(dx, b.y - me.y) < 260) { // worth asking whether a jump latches (no longer waits for the dash to be ready: openings do not depend on it)
        if (Math.abs(dx) < 66) { k.l = k.r = false; }           // too close to keep running while we think
        A.out = {};
        A.job = { kind: 'jump', gen: aiJumpJob(me, { ...k }, [AI_PRE], ['toward', 'none', 'away'], A.out, [2, 4, 0], true), out: A.out, frozen: { ...k }, age: 0, done: false };
        return;
    }
    const dodge = aiDodge(me, ball, lo, hi);    // the DEATH ball is going to reach us: pick the steering that keeps us furthest from it (a decoy cannot kill us: never dodge one)
    // In the air with the ball about to be where we come down (a slow ball creeping under us, or one rolling at our landing spot): we cannot steer out of it for ever, and the grapple only
    // grabs the nearest thing, so if the ball is that, grab it NOW and let the held plans (which look ahead for a safe release) decide what to do with it.
    if (!me.ground && grip && (A.cool <= 0 || b !== A.heldBody) && mine && (b === ball ? dodge : aiUrgent(me))) {
        const gd = Math.hypot(dx, b.y - me.y);
        if (gd < RANGE - 15 && gd > me.r + b.r + 6) {
            const near = aiNearest(me, b);
            if (near && near.b && near.ball === b) {
                if (!(A.airT > 0)) {           // (a rollout is not free: redo it every few ticks, not every tick)
                    A.airOk = aiAirGrabSafe(me);
                    A.airT = 4;
                }
                A.airT--;
                if (A.airOk) {
                    k.z = true;
                    return;
                }
            }
        }
    }
    if (dodge) {
        k.l = dodge.dir < 0;
        k.r = dodge.dir > 0;
        k.up = dodge.up;
    }
}
function aiDrive(i) {
    if (i <= aiLastI)
        aiTickN++;                             // a new tick (aiDrive runs once per AI per tick, in order)
    aiLastI = i;
    const me = players[i], A = ai[i], k = aiNoKeys();
    AIB = A.fb = aiPickFocus(me, A);           // the body every prediction below is about (see aiPickFocus)
    A.t -= DT;
    A.cool = Math.max(0, (A.cool || 0) - DT);
    A.noGrab = Math.max(0, A.noGrab - DT);
    if (me.onBall) {
        if (!A.held) {                         // just latched on
            A.held = true;
            A.hs = { t: 0, dashT: null, n: 0, plan: 'hold', next: 0.05, noDash: Math.random() >= AI_DASH_USE };
            if (A.rescueHold != null) {       // this grab is a rescue: hold the 'hold' plan for the planned moment, then let go (no replanning)
                A.hs.rescue = A.rescueHold;
                A.hs.next = A.rescueHold; // (the normal plans take over once the rescue hold is over)
                A.rescueHold = null;
            }
            A.E = null;
            A.job = null;
        }
        const hs = A.hs;
        A.heldBody = AIB;                      // (remembered for the cooldown after we let go)
        if (me.tball === AIB && !A.job && hs.t >= hs.next && hs.dashT === null) { // (re)plan; not once the dash is spent, that plan is committed
            A.out = { race: AI_RACE ? aiOtherThreat(me) : null };
            A.job = { kind: 'held', gen: aiHeldJob(me, hs, A.out), out: A.out, age: 0, done: false };
        }
        if (A.job && A.job.kind === 'held') {
            aiAdvance(A);
            if (A.job.done && A.job.age >= AI_PRE_H) {
                if (A.job.out.plan)
                    hs.plan = A.job.out.plan;
                A.raceMode = !!A.job.out.race;  // (if we let go during a race, it is to go and deal with the other ball: no sulking cooldown)
                hs.next = hs.t + 0.15;
                A.job = null;
            }
        }
        aiHeldKeys(me, AIB, hs, k);
        if (me.tball !== ball && aiPathMin(me, ball, 0, false, me.r, W - me.r) < me.r + ball.r + 12)
            k.z = false;                       // holding a decoy while the DEATH ball is about to reach us: let go and dodge
        if (me.tball === AIB && players.some(q => q.team !== me.team && q.alive && q.onBall && q.tball === AIB)) { // tug of war: an enemy has it too
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
            A.cool = A.raceMode ? 0.05 : 1;
            A.raceMode = false;
            A.t = 0;
        }
        aiFree(i, me, A, k);
    }
    Object.assign(me.keys, k);
}