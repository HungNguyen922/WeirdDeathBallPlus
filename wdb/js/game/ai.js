// ---- AI opponent: toggle either player with the buttons under the game, or keys 1 (Blue) / 2 (Red) ----
// Rules for the easy parts, a short-horizon planner for the hard ones. The planner copies the game, plays a handful of input plans forward with the real
// physics (itself and the ball; the other player is held where they stand), scores how each ends (goals and kills, how far the ball got toward the enemy goal
// and how fast, staying clear of the ball, being tethered to it) and follows the best one until the next decision.
//   tethered to the ball -> plan the swing and the throw      ball about to hit us -> plan a dodge
//   ball nearby          -> walk to it, jump, and grab it the moment it is the nearest thing in reach (the grapple latches onto the nearest thing)
//   ball far away        -> wait near the net
const AI_PERIOD = 0.2, AI_HORIZON = 0.4, AI_FAR = 260, AI_THREAT = 64; // decision interval (s), look-ahead (s), "ball nearby" distance, dodge distance (u)
const AI_STEER = [-1, 0, 1];
// While tethered: hold the grapple (until `rel`, a throw), optionally jump / weigh / dash (sp at the start).
const AI_HELD = [
    { jump: false, heavy: false, dash: false, rel: Infinity }, // hold on
    { jump: true, heavy: false, dash: false, rel: Infinity }, // float
    { jump: false, heavy: true, dash: false, rel: Infinity }, // weight (firmer rope, kicks)
    { jump: true, heavy: false, dash: false, rel: 0.25 }, // throw: let go after 0.25 s
    { jump: false, heavy: false, dash: true, rel: Infinity }, // dash
    { jump: false, heavy: false, dash: true, rel: 0.3 }, // dash, then throw
];
const AI_FREE = [{ jump: false, heavy: false, dash: false, rel: 0 }, { jump: true, heavy: false, dash: false, rel: 0 }]; // no grapple: walk / jump
const aiPlans = pats => pats.flatMap(pat => AI_STEER.map(dir => ({ ...pat, dir })));
const AI_HELD_PLANS = aiPlans(AI_HELD), AI_FREE_PLANS = aiPlans(AI_FREE);
const ai = [0, 1, 2, 3].map(() => ({ on: false, plan: null, t: 0, age: 0, noGrab: 0, held: false }));
const AI_SPECIALS = ['dash', 'plinko']; // the specials the planner knows how to use (marionette / decoy are left to humans)
// The rollouts step real physics objects, which nudges a few shared effect values (seesaw, hatchet glow, peg flash). Snapshot and restore them.
function snapshotFx() { return { sv: saw.v, st: saw.t, hp: [...padFlash], pf: pegs.map(q => q.flash) }; }
function restoreFx(s) {
    saw.v = s.sv;
    saw.t = s.st;
    padFlash[0] = s.hp[0];
    padFlash[1] = s.hp[1];
    pegs.forEach((q, n) => { q.flash = s.pf[n]; });
}
function aiKeys(plan, t, me) { // the keys a plan holds t seconds after it started
    return { l: plan.dir < 0, r: plan.dir > 0, up: plan.jump, dn: false, z: t < plan.rel, x: plan.heavy, sp: plan.dash && t < 0.1 && AI_SPECIALS.includes(me.special) };
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
function aiFoe(me) { // the enemy to plan against: the nearest living one (any one if none are left)
    const foes = players.filter(p => p.team !== me.team), live = foes.filter(f => f.alive), dist = f => Math.hypot(f.x - me.x, f.y - me.y);
    return (live.length ? live : foes).reduce((m, f) => (dist(f) < dist(m) ? f : m));
}
function aiRollout(me0, foe, plan, steps) {
    const me = aiClone(me0), b = Object.assign(new Ball(), ball), s = me.team === 0 ? 1 : -1;
    me.tball = me.tball === ball ? b : me.tball ? Object.assign(new Ball(), me.tball) : null; // tethered to the copy of the ball (or a copy of a decoy), never the real thing
    let minD = 1e9, tether = 0;
    for (let n = 0; n < steps; n++) {
        Object.assign(me.keys, aiKeys(plan, n * DT, me));
        me.step(b);
        const sc = b.step();
        if (sc !== null)
            return sc === me.team ? 10000 - n : -10000 + n; // a goal for us / against us
        const d = Math.hypot(me.x - b.x, me.y - b.y);
        if (d < me.r + b.r)
            return -9000 + n; // the death ball got us
        if (players.some(f => f.team !== me.team && f.alive && Math.hypot(f.x - b.x, f.y - b.y) < f.r + b.r))
            return 9000 - n; // it got them
        if (d < minD)
            minD = d;
        if (me.onBall)
            tether++;
    }
    let v = (b.x - NETX) * s; // how far the ball is on the enemy's side
    v += Math.max(-400, Math.min(700, b.vx * s)) * 0.35; // and how fast it is heading for their goal
    if (minD < 46)
        v -= (46 - minD) * 12; // stay clear of the ball
    v += tether * 0.15; // being tethered to the ball is control
    v += Math.max(-60, Math.min(120, (b.x - me.x) * s)) * 0.2; // better with the ball in front of us than behind us
    v -= 0.12 * Math.hypot(b.x - foe.x, b.y - foe.y) * Math.min(1, Math.hypot(b.vx, b.vy) / 300); // a fast ball should be heading at them
    return v;
}
function aiPlan(i, plans) { // the best of these plans from the current state
    const me = players[i], foe = aiFoe(me), A = ai[i], steps = Math.round(AI_HORIZON / DT);
    const snap = snapshotFx(); // the rollouts must leave no trace on the real game
    let best = null, bestV = -Infinity;
    for (const plan of plans) {
        const v = aiRollout(me, foe, plan, steps) + (plan === A.plan ? 12 : 0) + Math.random() * 2; // keep the current plan unless another is clearly better
        if (v > bestV) {
            bestV = v;
            best = plan;
        }
    }
    restoreFx(snap);
    return best;
}
function aiThreat(me) { // will the ball (flying on its own) pass within AI_THREAT of where we stand in the next 0.6 s?
    const b = Object.assign(new Ball(), ball);
    for (let n = 0; n < 72; n++) {
        b.step();
        if (Math.hypot(me.x - b.x, me.y - b.y) < AI_THREAT)
            return true;
    }
    return false;
}
function aiDecide(i) {
    const me = players[i], s = me.team === 0 ? 1 : -1, lo = me.team === 0 ? me.r : NETX + me.r, hi = me.team === 0 ? NETX - me.r : W - me.r;
    if (me.onBall)
        return { mode: 'held', ...aiPlan(i, AI_HELD_PLANS) };
    const snap = snapshotFx();
    const threat = aiThreat(me);
    restoreFx(snap);
    if (threat)
        return { mode: 'dodge', ...aiPlan(i, AI_FREE_PLANS) };
    if (Math.hypot(ball.x - me.x, ball.y - me.y) < AI_FAR || (ball.x - NETX) * s < 0) { // ball nearby or on our side: get to it, jump, grab
        const side = me.x >= ball.x ? 1 : -1, tx = Math.max(lo, Math.min(hi, ball.x + side * 72)), dx = tx - me.x; // stand 72 u off it, on the side we are already on
        const still = Math.hypot(ball.vx, ball.vy) < 140;
        return { mode: 'approach', dir: Math.abs(dx) < 10 ? 0 : Math.sign(dx), jump: Math.abs(dx) < 30 && still, heavy: false, dash: false, rel: 0 };
    }
    const dx = NETX - s * 70 - me.x; // far away on their side: wait near the net
    return { mode: 'wait', dir: Math.abs(dx) < 15 ? 0 : Math.sign(dx), jump: false, heavy: false, dash: false, rel: 0 };
}
function aiDrive(i) {
    const me = players[i], A = ai[i];
    A.t -= DT;
    A.age += DT;
    A.noGrab = Math.max(0, A.noGrab - DT);
    if (A.t <= 0) {
        A.t = AI_PERIOD;
        A.age = 0;
        A.plan = aiDecide(i);
    }
    const k = aiKeys(A.plan, A.age, me);
    if (A.held && !me.onBall)
        A.noGrab = 0.6; // we just let go of the ball (a throw): do not snatch it straight back
    A.held = me.onBall;
    if (!me.onBall && !k.z && !me.rope && !me.pending && A.noGrab <= 0 && A.plan.mode !== 'wait' && Math.hypot(ball.vx, ball.vy) < 450) {
        const near = me.candidates(ball).reduce((m, o) => (!m || o.d < m.d ? o : m), null);
        if (near && near.b && !near.decoy)
            k.z = true; // the death ball is the nearest thing in reach: latch on (decoys are ignored)
    }
    Object.assign(me.keys, k);
}
