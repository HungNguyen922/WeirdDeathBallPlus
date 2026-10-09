// NET - online play, client side. Load after input.js and before main.js.
// Online, the server owns the simulation. This file (1) sends my key presses, (2) buffers the snapshots the server sends (about 30 a second), and (3) every frame replays them
// through the game's own renderer: it interpolates between two snapshots a short moment in the past, loads the result into the game's globals with loadState(), and fires
// the one-off effects (goals, impacts, bat hits, trails) at the right moment. update() is never called online, so nothing here can disagree with the server about the game.
// The price of that is a little delay: you see the world NET_DELAY_MS late, and your own moves show up after a round trip. Client-side prediction is the later fix for that.
//
// Start it with  ?room=NAME  in the page URL, or the "Play online" button. Optional  &server=host:port  points at a different game server.
const NET_BITS = { l: 1, r: 2, up: 4, dn: 8, z: 16, x: 32, sp: 64 }; // must match server/server.js
const NET_DELAY_MS = 100; // how far in the past we draw: enough to always have a snapshot ahead of us to interpolate towards
const NET_TELEPORT = 150; // a body that moved further than this between two snapshots was reset / respawned: do not slide it across the arena

// ---- interpolation ----
const netWrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function netMix(a, b, u, key) { // blend two pieces of plain data: numbers slide, everything else (flags, strings, null) switches at the halfway point
    if (typeof a === 'number' && typeof b === 'number')
        return key && /ang$/i.test(key) ? a + netWrap(b - a) * u : a + (b - a) * u; // angles take the short way round
    if (Array.isArray(b))
        return Array.isArray(a) && a.length === b.length ? b.map((x, i) => netMix(a[i], x, u)) : u < 0.5 ? a : b;
    if (b && typeof b === 'object' && a && typeof a === 'object') {
        const o = {};
        for (const k in b)
            o[k] = k in a ? netMix(a[k], b[k], u, k) : b[k];
        return o;
    }
    return u < 0.5 ? a : b;
}
function netMixBody(a, b, u) { // a player, the ball, a decoy, a peg or an arrow
    if (!a || Math.hypot(b.x - a.x, b.y - a.y) > NET_TELEPORT)
        return u < 0.5 ? a : b;
    return netMix(a, b, u);
}
const netMixList = (la, lb, u) => (la.length === lb.length ? lb.map((b, i) => netMixBody(la[i], b, u)) : u < 0.5 ? la : lb); // different counts: something appeared or vanished
function netMixState(a, b, u) { // two saveState() snapshots -> one in between. Score, timers and flags come from whichever is nearer in time.
    if (a === b || u <= 0)
        return a;
    const s = u < 0.5 ? a : b;
    return { ...s, players: netMixList(a.players, b.players, u), ball: netMixBody(a.ball, b.ball, u), decoys: netMixList(a.decoys, b.decoys, u), pegs: netMixList(a.pegs, b.pegs, u), arrows: netMixList(a.arrows, b.arrows, u), saw: netMix(a.saw, b.saw, u) };
}

const net = {
    on: false, slot: -1, ws: null, room: '', running: false, rtt: 0, status: '',
    keys: noKeys(), seq: 0, ack: 0, pendingSpecial: null,
    dtMs: 1000 / 120, snapEvery: 4,
    buf: [], evq: [], off: 0, lastSnapAt: 0, cur: null, shown: null, shape: null,
    setStatus(t) {
        this.status = t;
        const el = document.getElementById('netstatus');
        if (el)
            el.textContent = t;
    },
    describe() {
        if (!this.ws || this.ws.readyState > 1)
            return 'Disconnected. Reload the page to reconnect.';
        const who = this.slot === 0 ? 'you are Blue' : this.slot === 1 ? 'you are Red' : 'spectating';
        const state = this.slot >= 0 && !this.running ? ' - waiting for an opponent...' : '';
        return `Online, room "${this.room}": ${who}${state}${this.rtt ? ` (ping ${Math.round(this.rtt)} ms)` : ''}`;
    },
    join(room, server) {
        if (this.ws)
            return;
        this.on = true;
        this.room = room;
        const url = server || netServerUrl();
        this.setStatus('Connecting to ' + url + '...');
        const ws = this.ws = new WebSocket(url);
        ws.onopen = () => {
            ws.send(JSON.stringify({ t: 'join', room, special: (allPlayers[0] || {}).special }));
            this.pingTimer = setInterval(() => this.ws && this.ws.readyState === 1 && this.ws.send(JSON.stringify({ t: 'ping', c: performance.now() })), 2000);
        };
        ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error('bad message', err); } };
        ws.onclose = () => { clearInterval(this.pingTimer); this.setStatus(this.describe()); };
        ws.onerror = () => this.setStatus('Could not reach the game server at ' + url + '. Is it running? (node server/server.js)');
        const btn = document.getElementById('online');
        if (btn) {
            btn.textContent = 'Online: On';
            btn.classList.add('on');
        }
    },
    onMessage(m) {
        if (m.t === 'welcome') {
            this.slot = m.slot;
            this.dtMs = 1000 / m.hz;
            this.snapEvery = m.snapEvery;
            this.setStatus(this.describe());
        } else if (m.t === 'roster') {
            this.running = m.running;
            this.setStatus(this.describe());
        } else if (m.t === 'snap') {
            this.onSnapshot(m);
        } else if (m.t === 'pong') {
            this.rtt = performance.now() - m.c;
            this.setStatus(this.describe());
        } else if (m.t === 'error')
            this.setStatus('Server: ' + m.msg);
    },
    onSnapshot(m) {
        const now = performance.now(), last = this.buf[this.buf.length - 1];
        if (last && m.tick < last.tick) { // the tick counter went backwards: a new match started
            this.reset();
            events.onNewRound();
        }
        const sample = now - m.tick * this.dtMs; // how long after "server time zero" this packet arrived; the smallest recent value is the best clock estimate
        this.off = this.buf.length ? Math.min(sample, this.off + (now - this.lastSnapAt) * 0.0005) : sample;
        this.lastSnapAt = now;
        this.buf.push({ tick: m.tick, s: m.s });
        if (this.buf.length > 80)
            this.buf.shift();
        for (const e of m.ev)
            this.evq.push(e);
        this.ack = m.ack;
    },
    reset() {
        this.buf = [];
        this.evq = [];
        this.cur = null;
    },
    // ---- sending ----
    sendKeys() {
        let bits = 0;
        for (const k in NET_BITS)
            if (this.keys[k])
                bits |= NET_BITS[k];
        if (this.ws && this.ws.readyState === 1 && this.slot >= 0)
            this.ws.send(JSON.stringify({ t: 'in', n: ++this.seq, k: bits }));
    },
    setSpecial(id) {
        this.pendingSpecial = id;
        if (this.ws && this.ws.readyState === 1)
            this.ws.send(JSON.stringify({ t: 'sp', s: id }));
    },
    // ---- drawing: called once per rendered frame instead of update() ----
    frame(now) {
        const buf = this.buf;
        if (!buf.length)
            return;
        const newest = buf[buf.length - 1].tick;
        let target = (now - this.off - NET_DELAY_MS) / this.dtMs; // the server tick we should be showing right now
        if (target > newest)
            target = newest; // starved (or the match is paused): hold on the newest snapshot
        if (this.cur === null || Math.abs(target - this.cur) > 240)
            this.cur = Math.floor(target) - 1;
        for (let n = 0; this.cur + 1 <= target && n < 24; n++)
            this.applyTick(++this.cur); // one step per sim tick, so trails and effects see the same cadence as offline play
        while (buf.length > 2 && buf[1].tick <= this.cur)
            buf.shift();
    },
    show(st) { // load a state into the game's globals for drawing (also used to put the drawn world back after the predictor borrowed them)
        this.shown = st;
        loadState(st);
        if (this.slot >= 0) { // my own side shows what I am pressing right now, not what the server heard a round trip ago
            Object.assign(allPlayers[this.slot].keys, this.keys);
            if (this.pendingSpecial) {
                if (allPlayers[this.slot].special === this.pendingSpecial)
                    this.pendingSpecial = null;
                else
                    allPlayers[this.slot].special = this.pendingSpecial;
            }
        }
    },
    applyTick(t) {
        const buf = this.buf;
        let i = 0;
        while (i + 1 < buf.length && buf[i + 1].tick <= t)
            i++;
        const a = buf[i], b = buf[i + 1] || a;
        const u = b.tick > a.tick && b.tick - a.tick <= 3 * this.snapEvery ? Math.min(1, Math.max(0, (t - a.tick) / (b.tick - a.tick))) : 0;
        this.show(this.shape ? this.shape(netMixState(a.s, b.s, u)) : netMixState(a.s, b.s, u)); // this.shape: net/predict.js overlays my predicted player
        while (this.evq.length && this.evq[0][1] <= t)
            this.fire(this.evq.shift());
        if (pause > 0)
            trailMelt();
        else {
            for (const p of players)
                if (p.alive)
                    events.onBodyStep(p);
            events.onBodyStep(ball);
            for (const d of decoys)
                events.onBodyStep(d);
        }
    },
    fire(e) { // the renderer's hooks, driven by what the server's simulation reported
        const ref = r => (r === 'b' ? ball : r[0] === 'p' ? allPlayers[+r.slice(1)] : decoys[+r.slice(1)] || ball);
        if (e[0] === 'pt')
            events.onPoint(e[2], e[3]);
        else if (e[0] === 'nr')
            events.onNewRound();
        else if (e[0] === 'im')
            events.onImpact(allPlayers[e[2]], e[3], e[4], e[5], e[6], e[7]);
        else if (e[0] === 'bt')
            events.onBatHit(allPlayers[e[2]], ref(e[3]), e[4], e[5], e[6], e[7], e[8]);
    },
};

function netServerUrl() {
    const q = new URLSearchParams(location.search).get('server'), tls = location.protocol === 'https:';
    if (q)
        return q.includes('://') ? q : (tls ? 'wss://' : 'ws://') + q;
    return (tls ? 'wss://' : 'ws://') + (location.host || 'localhost:8080'); // opened from a file: assume a local server
}

// ---- keyboard while online: both players' layouts drive MY seat (arrows + X / C / Z, or WASD + F / G / H) ----
const NET_KEYMAP = { ...bindings[0][1], ...bindings[1][1] };
function netKeyEvent(e, v) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key, act = NET_KEYMAP[key] || NET_KEYMAP[e.code];
    if (act) {
        e.preventDefault();
        if (net.keys[act] !== v) {
            net.keys[act] = v;
            net.sendKeys();
        }
    }
    if (v && key === 'Escape')
        closeSpecialMenu();
}
window.addEventListener('blur', () => { // losing focus must not leave a key stuck down on the server
    if (net.on && Object.values(net.keys).some(Boolean)) {
        Object.assign(net.keys, noKeys());
        net.sendKeys();
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && net.on)
        window.dispatchEvent(new Event('blur'));
});

const onlineBtn = document.getElementById('online');
if (onlineBtn)
    onlineBtn.addEventListener('click', () => {
        if (net.on) {
            location.href = location.pathname; // simplest way back to offline play: a fresh page
            return;
        }
        const room = (prompt('Room name (letters, numbers, - and _). Share it with a friend so they join the same room:', 'test') || '').trim();
        if (/^[A-Za-z0-9_-]{1,24}$/.test(room))
            net.join(room);
        cv.focus();
    });
{
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^[A-Za-z0-9_-]{1,24}$/.test(room))
        net.join(room);
}
