// NET - client-side prediction + reconciliation for MY player. Load after net/client.js, before main.js.
//
// The server stays authoritative. Without prediction you see yourself ~100 ms interpolation delay + a round trip late. With it:
//   1. Every frame we run a private copy of the whole sim (the same update() the server runs) up to the tick the server will be at when my input arrives:
//        target = serverTickNow + rtt / tick-length.   My own inputs are applied at the tick they will reach the server (pt = next predicted tick).
//   2. Every snapshot (server tick T, ack = last input of mine the server had applied) we ROLL BACK: load the server's state at T, throw away inputs with seq <= ack
//      (the snapshot already contains them), and replay the rest, tick by tick, up to where we were. The replayed result is the new prediction.
//      Opponent keys are held at whatever the snapshot says (we cannot know better). If it was wrong, the replay differs a little: that difference is
//      smoothed away by an offset that decays over a few frames instead of snapping (a jump bigger than PRED_SNAP_DIST snaps).
//   3. Drawing: the world is still the interpolated past, but MY player is overlaid from the prediction. If I am tethered to the death ball, the ball comes from
//      the prediction too (otherwise the rope would join two different moments in time). Deaths / round changes are always the server's word.
// Effects: the prediction runs with the renderer hooks muted, so goals, impacts and trails still come only from the server's events (no doubles).
const PRED_MAX_AHEAD = 40;   // never predict more than this many ticks past the last server state (spikes / stalls)
const PRED_SNAP_DIST = 120;  // a correction bigger than this (u) is a teleport (respawn, hatchet): show it at once
const PRED_ERR_DECAY = 0.86; // per rendered frame, share of the visual correction that is left

const pred = { state: null, tick: 0, ack: 0, log: [], err: { x: 0, y: 0 }, lastT: -1 }; // state = saveState() at pred.tick; log = my inputs { seq, pt, bits }

function predBitsOf(keys) {
    let b = 0;
    for (const k in NET_BITS)
        if (keys[k])
            b |= NET_BITS[k];
    return b;
}
function predQuiet(fn) { // run the sim without telling the renderer
    const saved = {};
    for (const k in events) {
        saved[k] = events[k];
        events[k] = () => {};
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
function predAdvance(target) {
    if (!pred.state)
        return;
    target = Math.min(target, pred.tick + PRED_MAX_AHEAD);
    if (target <= pred.tick)
        return;
    loadState(pred.state);
    predQuiet(() => { while (pred.tick < target) predStep(); });
    pred.state = saveState();
}
// A snapshot arrived: roll back to it and replay my unconfirmed inputs. Returns how far (u) my player moved compared with what we had predicted.
function predReconcile(T, s, ack) {
    const slot = net.slot, old = pred.state ? pred.state.players[slot] : null;
    const fresh = !pred.state || T < pred.lastT || pred.tick < T - 240; // first snapshot, or a new match began
    pred.lastT = T;
    pred.ack = ack;
    pred.log = pred.log.filter(e => e.seq > ack);
    const end = fresh ? T : Math.max(pred.tick, T);
    pred.tick = T;
    loadState(s);
    predQuiet(() => { while (pred.tick < end) predStep(); });
    pred.state = saveState();
    if (!old || fresh) {
        pred.err.x = pred.err.y = 0;
        return 0;
    }
    const me = pred.state.players[slot], dx = old.x - me.x, dy = old.y - me.y, e = Math.hypot(dx, dy);
    if (e > PRED_SNAP_DIST)
        pred.err.x = pred.err.y = 0;
    else {
        pred.err.x += dx; // what is drawn is prediction + err, so the picture does not jump; err then fades
        pred.err.y += dy;
    }
    return e;
}
function predFrame(now) {
    pred.err.x *= PRED_ERR_DECAY;
    pred.err.y *= PRED_ERR_DECAY;
    if (!pred.state || net.slot < 0 || !net.running)
        return;
    predAdvance(Math.floor((now - net.off) / net.dtMs + net.rtt / net.dtMs) + 1);
    if (net.shown)
        net.show(net.shown); // the predictor borrowed the game's globals: put the drawn world back
}
// Called by net.applyTick on the interpolated state just before it is loaded for drawing: put my predicted player (and the ball, when tethered to it) into it.
function predShape(mixed) {
    const slot = net.slot;
    if (!pred.state || slot < 0 || !net.running || mixed.pause > 0)
        return mixed;
    const me = pred.state.players[slot], theirs = mixed.players[slot];
    if (!theirs.alive)
        return mixed; // death is the server's call (a predicted death is shown early: it is almost always the ball, which we simulate too)
    const mine = { ...me, x: me.x + pred.err.x, y: me.y + pred.err.y };
    if (me.tball > 0)
        mine.tball = theirs.tball; // a decoy index in the predicted world means nothing in the interpolated one
    const players = mixed.players.slice();
    players[slot] = mine;
    const out = { ...mixed, players };
    if (me.tball === 0)
        out.ball = pred.state.ball;
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
}
