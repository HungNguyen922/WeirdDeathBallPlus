// NET - client-side prediction + reconciliation for MY player and the things I affect. Load after net/client.js, before main.js.
//
// The server stays authoritative. Without prediction you see yourself ~100 ms interpolation delay + a round trip late. With it:
//   1. Every frame we run a private copy of the whole sim (the same update() the server runs) up to the tick the server will be at when my input arrives:
//        target = serverTickNow + rtt / tick-length.   My own inputs are applied at the tick they will reach the server (pt = next predicted tick).
//   2. Every snapshot (server tick T, ack = last input of mine the server had applied) we ROLL BACK: load the server's state at T, throw away inputs with seq <= ack
//      (the snapshot already contains them), and replay the rest, tick by tick, up to where we were. The replayed result is the new prediction.
//      Opponent keys are held at whatever the snapshot says (we cannot know better). If it was wrong, the replay differs a little: that difference is
//      smoothed away by an offset that decays over a few frames instead of snapping (a jump bigger than PRED_SNAP_DIST snaps).
//   3. Drawing: the opponent and everything of theirs stays on the interpolated (delayed) timeline. What comes from the prediction (the "predicted timeline"):
//        - my player,
//        - the death ball (PRED_WORLD): it is the thing my bat, arrows, grapple and crash shots act on, so it must live on MY timeline or my swing would land ~150 ms
//          after it is drawn, and the ball would pop between timelines every time I latch on / let go. Where the server disagrees (the opponent touched it) the correction is
//          blended in over a few frames,
//        - arrows and plinko pegs I made (they appear the instant I release),
//        - my bat-hit / impact effects, fired at predicted time; the server's later copy of the same event is dropped.
//      An opponent who is tethered to the ball gets their rope end moved onto the predicted ball so the rope never detaches from it.
//      Deaths / round changes are always the server's word. Add  ?predworld=0  to the page URL to go back to predicting only my own player.
const PRED_MAX_AHEAD = 40;   // never predict more than this many ticks past the last server state (spikes / stalls)
const PRED_SNAP_DIST = 120;  // a correction bigger than this (u) is a teleport (respawn, hatchet): show it at once
const PRED_BALL_SNAP = 220;  // same, for the ball (it is fast: a late opponent hit can legitimately move it far)
const PRED_ERR_DECAY = 0.86; // per rendered frame, share of the visual correction that is left
const PRED_EVENT_SLACK = 24; // a server event this many ticks from a predicted one of the same kind is the same event
const PRED_WORLD = !(typeof location !== 'undefined' && /[?&]predworld=0/.test(location.search || ''));

const pred = { state: null, tick: 0, ack: 0, log: [], err: { x: 0, y: 0 }, errBall: { x: 0, y: 0 }, lastT: -1, lastFix: 0, visited: 0, fired: [] }; // state = saveState() at pred.tick; log = my inputs { seq, pt, bits }

function predBitsOf(keys) {
    let b = 0;
    for (const k in NET_BITS)
        if (keys[k])
            b |= NET_BITS[k];
    return b;
}
function predQuiet(fn, capture) { // run the sim without telling the renderer; with `capture`, my own bat hits and impacts are collected instead
    const saved = {};
    for (const k in events) {
        saved[k] = events[k];
        events[k] = () => {};
    }
    if (capture) {
        events.onBatHit = (p, b, x, y, ux, uy, k) => { if (p.id === net.slot) capture.push(['bt', pred.tick + 1, x, y, ux, uy, k, b.r]); };
        events.onImpact = (p, x, y, ux, uy, v) => { if (p.id === net.slot) capture.push(['im', pred.tick + 1, x, y, ux, uy, v]); };
    }
    try { return fn(); } finally { Object.assign(events, saved); }
}
function predBitsAt(t) { // my key mask at predicted tick t, from inputs the server has not confirmed yet (null = whatever the loaded state says)
    let b = null;
    for (const e of pred.log)
        if (e.seq > pred.ack && e.pt <= t)
            b = e.bits;
    return b;
}
function predStep() { // one tick of the private sim (the caller has loaded pred's world and muted the events)
    const b = predBitsAt(pred.tick + 1);
    if (b !== null) {
        const k = allPlayers[net.slot].keys;
        for (const n in NET_BITS)
            k[n] = !!(b & NET_BITS[n]);
    }
    update();
    pred.tick++;
}
const predNow = () => Math.floor((performance.now() - net.off) / net.dtMs + net.rtt / net.dtMs); // the server tick my input would land on, from the clock
function predPress(bits, seq, base = pred.state ? pred.tick : predNow()) { // my keys changed and were sent as input #seq: it will be applied by the server at the next predicted tick
    pred.log.push({ seq, pt: base + 1, bits });
    if (pred.log.length > 240)
        pred.log.shift();
}
function predFire(e) { // one of MY effects, at the moment the predicted world produced it (the server's copy is dropped later by predSkipServerEvent)
    const me = allPlayers[net.slot];
    pred.fired.push({ type: e[0], tick: e[1], used: false });
    if (pred.fired.length > 60)
        pred.fired.shift();
    if (e[0] === 'bt')
        events.onBatHit(me, { r: e[7] }, e[2], e[3], e[4], e[5], e[6]);
    else
        events.onImpact(me, e[2], e[3], e[4], e[5], e[6]);
}
function predSkipServerEvent(e) { // net.fire asks this for every server event
    if (!pred.state || (e[0] !== 'bt' && e[0] !== 'im') || e[2] !== net.slot)
        return false;
    for (const f of pred.fired)
        if (!f.used && f.type === e[0] && Math.abs(f.tick - e[1]) <= PRED_EVENT_SLACK) {
            f.used = true;
            return true;
        }
    return false;
}
function predAdvance(target) {
    if (!pred.state)
        return;
    target = Math.min(target, pred.tick + PRED_MAX_AHEAD);
    if (target <= pred.tick)
        return;
    const cap = [];
    loadState(pred.state);
    predQuiet(() => { while (pred.tick < target) predStep(); }, cap);
    pred.state = saveState();
    for (const e of cap)
        if (e[1] > pred.visited) // a tick is only ever "new" once: rollbacks replay old ticks silently
            predFire(e);
    pred.visited = Math.max(pred.visited, pred.tick);
}
// A snapshot arrived: roll back to it and replay my unconfirmed inputs. Returns how far (u) my player moved compared with what we had predicted.
function predReconcile(T, s, ack) {
    const slot = net.slot, old = pred.state ? pred.state.players[slot] : null, oldBall = pred.state ? pred.state.ball : null, oldTick = pred.tick;
    const fresh = !pred.state || T < pred.lastT || pred.tick < T - 240; // first snapshot, or a new match began
    pred.lastT = T;
    pred.ack = ack;
    pred.log = pred.log.filter(e => e.seq > ack);
    const end = fresh ? T : Math.max(pred.tick, T);
    pred.tick = T;
    loadState(s);
    predQuiet(() => { while (pred.tick < end) predStep(); });
    pred.state = saveState();
    if (fresh) {
        pred.visited = T;
        pred.fired = [];
    }
    pred.lastFix = old && !fresh ? Math.hypot(old.x - pred.state.players[slot].x, old.y - pred.state.players[slot].y) : 0;
    if (!old || fresh) {
        pred.err.x = pred.err.y = pred.errBall.x = pred.errBall.y = 0;
        return 0;
    }
    const me = pred.state.players[slot], dx = old.x - me.x, dy = old.y - me.y, e = Math.hypot(dx, dy);
    if (e > PRED_SNAP_DIST)
        pred.err.x = pred.err.y = 0;
    else {
        pred.err.x += dx; // what is drawn is prediction + err, so the picture does not jump; err then fades
        pred.err.y += dy;
    }
    if (oldBall && oldTick === pred.tick) { // the same for the ball (compared at the same tick; if we were behind, there is nothing to compare)
        const bx = oldBall.x - pred.state.ball.x, by = oldBall.y - pred.state.ball.y;
        if (Math.hypot(bx, by) > PRED_BALL_SNAP)
            pred.errBall.x = pred.errBall.y = 0;
        else {
            pred.errBall.x += bx;
            pred.errBall.y += by;
        }
    }
    return e;
}
function predFrame(now) {
    pred.err.x *= PRED_ERR_DECAY;
    pred.err.y *= PRED_ERR_DECAY;
    pred.errBall.x *= PRED_ERR_DECAY;
    pred.errBall.y *= PRED_ERR_DECAY;
    if (!pred.state || net.slot < 0 || !net.running)
        return;
    predAdvance(predNow() + 1);
    if (net.shown)
        net.show(net.shown); // the predictor borrowed the game's globals: put the drawn world back
}
// Called by net.applyTick on the interpolated state just before it is loaded for drawing: put the predicted timeline's parts into it.
function predShape(mixed) {
    const slot = net.slot;
    if (!pred.state || slot < 0 || !net.running || mixed.pause > 0)
        return mixed;
    const ps = pred.state, me = ps.players[slot], theirs = mixed.players[slot];
    let out = { ...mixed };
    if (PRED_WORLD && ps.pause <= 0) { // (a goal scored in the predicted world freezes it: until the drawn world gets there too, only my player is predicted)
        const b = ps.ball;
        out.ball = { ...b, x: b.x + pred.errBall.x, y: b.y + pred.errBall.y };
        out.pegs = mixed.pegs.filter(q => q.owner !== slot).concat(ps.pegs.filter(q => q.owner === slot));
        out.arrows = mixed.arrows.filter(a => a.owner !== slot).concat(ps.arrows.filter(a => a.owner === slot));
        out.players = mixed.players.map((q, i) => { // an opponent tethered to the ball: their hook is on the ball's edge, so move it with the ball
            if (i === slot || !q.onBall || q.tball !== 0 || !q.rope)
                return q;
            const ang = out.ball.th + q.hookAng;
            return { ...q, rope: { ...q.rope, x: out.ball.x + Math.cos(ang) * out.ball.r, y: out.ball.y + Math.sin(ang) * out.ball.r } };
        });
    } else if (me.tball === 0)
        out.ball = ps.ball; // old behaviour: only while I am tethered to it
    if (!theirs.alive)
        return out; // death is the server's call (a predicted death is shown early: it is almost always the ball, which we simulate too)
    const mine = { ...me, x: me.x + pred.err.x, y: me.y + pred.err.y };
    if (me.tball > 0)
        mine.tball = theirs.tball; // a decoy index in the predicted world means nothing in the interpolated one
    const players = out.players.slice();
    players[slot] = mine;
    out.players = players;
    return out;
}

// ---- hook into net (client.js) when running in the page ----
if (typeof net.onSnapshot === 'function') {
    const onSnap = net.onSnapshot.bind(net), frame = net.frame.bind(net), sendKeys = net.sendKeys.bind(net);
    net.onSnapshot = function (m) {
        onSnap(m);
        if (this.slot >= 0 && this.running) {
            predReconcile(m.tick, m.s, m.ack);
            if (this.shown)
                this.show(this.shown);
        } else
            pred.state = null;
    };
    net.sendKeys = function () {
        const before = this.seq;
        sendKeys();
        if (this.seq !== before && this.running)
            predPress(predBitsOf(this.keys), this.seq);
    };
    net.frame = function (now) {
        predFrame(now);
        frame(now);
    };
    net.shape = predShape;
    net.skipEvent = predSkipServerEvent;
    net.extra = () => `prediction on${PRED_WORLD ? '' : ' (player only)'}, ${pred.state ? pred.tick - pred.lastT : 0} ticks ahead, last fix ${pred.lastFix.toFixed(1)} u`; // shown in the status line next to the ping
}