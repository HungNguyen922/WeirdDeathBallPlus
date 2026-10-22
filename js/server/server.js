// SERVER - serves the game files and runs online matches.  Start:  node server/server.js [port]     then open  http://localhost:8080/?room=test  in two tabs.
//
// Model (authoritative host): the server owns the real simulation, one per room. Clients send only their key presses; the server steps the sim at the game's fixed rate and
// sends everybody a snapshot of the whole world (saveState) 30 times a second, plus the one-off events (goals, impacts, bat hits) the renderer needs for its effects.
//
// Teams: a connection is on Blue (team 0), on Red (team 1) or waiting / spectating (team -1). A team has at most TEAM_MAX players. Seats are player ids: Blue sits in 0 then 2, Red in
// 1 then 3, in the order they joined the team. The first player into a room goes to Blue, the second to Red; everybody after that waits until the HOST (the player who made the room,
// passed on if they leave) moves them. The match runs only while both teams have a player (1v1, 1v2 and 2v2 all work); any change to who is seated restarts it.
//
// Protocol: JSON text messages over a WebSocket.
//   client -> server   {t:'join', room, special, lobby2v2}  join a room; lobby2v2 = true only counts for the player who creates the room (they become the host)
//                      {t:'in', n, k}                      my keys changed. n = my input counter, k = bit mask: l1 r2 up4 dn8 z16 x32 sp64 sp2 128.   (z = grapple, x = weight, sp = special)
//                      {t:'sp', s}                         equip special ability s (ignored while pick screens are on)
//                      {t:'fixed', v}                      host only: specials only on pick screens (true) or free swapping (false); restarts the match
//                      {t:'sp', s, slot}                   (slot 1 = second special) and 
//                      {t:'two', shift}                        (host only)
//                      {t:'swap', v}                       host only: switch sides every 5 points (true) or never (false); restarts the match
//                      {t:'lobby2v2', v}                   host only: 2v2 lobby on (newcomers fill Blue, Red, Blue 2, Red 2 and the match waits for all four seats) or off
//                      {t:'assign', c, to}                 host only: move member c to team 0 (Blue), 1 (Red) or -1 (waiting); restarts the match if seats change
//                      {t:'chat', text}                    say something to everybody in the room (trimmed, at most CHAT_MAX characters, rate limited)
//                      {t:'ping', c}                       latency probe
//                      {t:'refresh', token}                I changed my name or skin on my account: look me up again (the token must belong to the same account) and send everyone a fresh roster
//   server -> client   {t:'welcome', room, slot, cid, tick, hz, snapEvery}   slot: 0..3 = a seat, -1 = waiting / spectating; cid = your member id
//                      {t:'slot', slot}                    your seat changed (the host moved you)
//                      {t:'roster', slots:[bool x4], spectators, running, lobby2v2, host, you, members:[{c, team, slot, host, name, skin}]}   skin = the account's skin (a list of layers, see js/skin-data.js) or null
//                      {t:'snap', tick, ack, s, ev}         s = saveState(), ack = my last input counter the server has applied, ev = [[name, tick, ...args], ...]
//                      {t:'chat', c, team, text}           somebody in the room said something (c = their member id, team = 0 Blue / 1 Red / -1 waiting); also sent back to the sender.  {t:'chat', sys:true, text} is a note from the server to one player
//                      {t:'pong', c, tick, tps}    {t:'error', msg}
const http = require('http'), fs = require('fs'), path = require('path');
const { attachWebSocket } = require('./ws.js');
const { loadSim, ROOT } = require('./sim-node.js');
const accounts = require('./accounts.js');

const TICK_HZ = 120, DT_MS = 1000 / TICK_HZ;
const SNAP_EVERY = [1, 2, 3, 4, 5, 6].includes(+process.env.SNAP_EVERY) ? +process.env.SNAP_EVERY : 4; // a snapshot every 4 ticks = 30 Hz. SNAP_EVERY=2 node js/server/server.js sends 60 Hz: a little less lag, about twice the bandwidth (clients adapt, the value is sent in 'welcome')
const SNAP_BACKLOG = 48 * 1024; // a client with more than this still unsent skips snapshots (each one is the full world, so a skipped one costs nothing; a queue of stale ones makes it lag for seconds)
const MAX_CATCHUP = 8; // never run more than this many ticks in one go (after a stall, drop the debt instead of spiralling)
const MAX_ROOMS = 50, MAX_SPECTATORS = 8, MSG_PER_SEC = 400;
const CHAT_MAX = 120, CHAT_BURST = 5, CHAT_WINDOW_MS = 5000; // chat: longest message, and at most CHAT_BURST messages per CHAT_WINDOW_MS per player
const TEAM_MAX = 2; // players per team (seats 0 / 2 are Blue, 1 / 3 are Red)
const SPECIAL_IDS = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat', 'barbwire', 'warp', 'awakened', 'explode', 'hopper', 'boomerang', 'portal', 'swap', 'smoke', 'pong', 'mines']; // the same ids as in render/special-menu.js and game/rules.js

// Code that runs INSIDE a room's sandbox: it captures the game's events (the renderer's hooks) into a list, and applies input bits to a player's keys.
const ROOM_PRELUDE = `
var __ev = [], __tick = 0, __done = null; // __done: set when a point wins the match ({ score: [blue, red] }); the room reads it and clears it
const __ref = b => b === ball ? 'b' : b instanceof Player ? 'p' + b.id : 'd' + decoys.indexOf(b);
events.onPoint = (team, why) => { __ev.push(['pt', __tick, team, why]); if (score[team] >= WIN) __done = { score: [score[0], score[1]] }; };
events.onNewRound = () => __ev.push(['nr', __tick]);
events.onImpact = (p, x, y, ux, uy, v) => __ev.push(['im', __tick, p.id, x, y, ux, uy, v]);
events.onBatHit = (p, b, x, y, ux, uy, k) => __ev.push(['bt', __tick, p.id, __ref(b), x, y, ux, uy, k]);
function __setKeys(i, bits) {
    const k = allPlayers[i].keys;
    k.l = !!(bits & 1); k.r = !!(bits & 2); k.up = !!(bits & 4); k.dn = !!(bits & 8); k.z = !!(bits & 16); k.x = !!(bits & 32); k.sp = !!(bits & 64); k.sp2 = !!(bits & 128);
}
`;

class Room {
    constructor(name) {
        this.name = name;
        this.sim = loadSim();
        this.sim.run(ROOM_PRELUDE);
        this.conns = new Set(); // everyone in the room. Room sets on each: cid (member id), team (0 / 1 / -1), order, slot (seat 0..3 or -1), special, moved
        this.seats = [null, null, null, null]; // connections by seat (= player id)
        this.bits = [0, 0, 0, 0]; // latest key mask per seat
        this.seq = [0, 0, 0, 0]; // latest input counter per seat (echoed back as `ack`)
        this.nextCid = 1;
        this.nextOrder = 1;
        this.host = null; // the connection allowed to change room settings and move players
        this.fixed = false; // specials only on pick screens
        this.twoSpecials = false; // the host's "two specials per player" option
        this.swapSides = true; // the host's "switch sides every 5 points" option
        this.ranked = false; // the host's "Ranked" option: only a ranked match changes ratings. Needs everyone seated signed in (see rankedOk)
        this.lobby2v2 = false; // 2v2 lobby: newcomers fill all four seats automatically and the match waits until every seat is taken
        this.tick = 0;
        this.running = false;
        this.acc = 0;
        this.last = performance.now();
        this.tps = 0; this.tpsN = 0; this.tpsT = performance.now(); // achieved sim ticks per second (should sit at 120)
    }
    get everyone() { return [...this.conns]; }
    get empty() { return this.conns.size === 0; }
    teamCount(t) { let n = 0; for (const c of this.conns) if (c.team === t) n++; return n; }
    openTeam() { // 2v2 lobby: the team a newcomer should take (the emptier one that still has a seat, Blue on a tie), or -1 when all seats are taken
        const open = [0, 1].filter(t => this.teamCount(t) < TEAM_MAX);
        return open.length ? open.reduce((a, b) => (this.teamCount(b) < this.teamCount(a) ? b : a)) : -1;
    }
    fillSeats() { // 2v2 lobby: whoever has been waiting longest takes any free seat
        if (!this.lobby2v2)
            return;
        for (const c of [...this.conns].filter(x => x.team < 0).sort((a, b) => a.order - b.order)) {
            const t = this.openTeam();
            if (t < 0)
                break;
            c.team = t;
            c.order = this.nextOrder++;
        }
    }
    // Work out the seats from each connection's team: a team's members take its seats in the order they joined the team. Returns true if any seat changed.
    reseat() {
        const old = this.seats, seats = [null, null, null, null];
        for (const t of [0, 1])
            [...this.conns].filter(c => c.team === t).sort((a, b) => a.order - b.order).slice(0, TEAM_MAX).forEach((c, i) => { seats[2 * i + t] = c; });
        let changed = false;
        for (let i = 0; i < 4; i++)
            if (old[i] !== seats[i]) {
                changed = true;
                this.bits[i] = 0;
                this.seq[i] = 0;
            }
        this.seats = seats;
        for (const c of this.conns) {
            const was = c.slot;
            c.slot = seats.indexOf(c); // -1 = waiting
            c.moved = was !== undefined && was !== c.slot;
        }
        return changed;
    }
    // After anything that may have changed who is seated: tell the people who moved, (re)start or pause the match, send the roster.
    settle(changed) {
        for (const c of this.conns)
            if (c.moved) {
                c.moved = false;
                c.send(JSON.stringify({ t: 'slot', slot: c.slot }));
            }
        if (this.ranked && !this.rankedOk()) {
            this.ranked = false;
            this.say('Ranked is off: everyone seated has to be signed in.');
        }
        const need = this.lobby2v2 ? TEAM_MAX : 1; // a 2v2 lobby waits for full teams, otherwise one player each is enough
        const ready = this.teamCount(0) >= need && this.teamCount(1) >= need; // an empty (or, in a 2v2 lobby, unfilled) team means the match waits
        if (ready && (changed || !this.running))
            this.start();
        else if (!ready)
            this.running = false;
        this.roster();
        if (!this.running && this.tick > 0)
            this.snapshot(); // someone watching a paused room still gets to see the board
    }
    join(conn, special, special2) {
        let team = this.lobby2v2 ? this.openTeam() : [0, 1].find(t => this.teamCount(t) === 0); // a 2v2 lobby seats newcomers anywhere there is room; otherwise a team with nobody on it, and later arrivals wait for the host
        if (team === undefined)
            team = -1;
        if (team < 0 && [...this.conns].filter(c => c.team < 0).length >= MAX_SPECTATORS)
            return -2;
        conn.cid = this.nextCid++;
        conn.team = team;
        conn.order = this.nextOrder++;
        conn.special = SPECIAL_IDS.includes(special) ? special : 'dash';
        conn.special2 = SPECIAL_IDS.includes(special2) && special2 !== conn.special ? special2 : SPECIAL_IDS.find(s => s !== conn.special);
        this.conns.add(conn);
        if (!this.host)
            this.host = conn;
        const changed = this.reseat();
        conn.send(JSON.stringify({ t: 'welcome', room: this.name, slot: conn.slot, cid: conn.cid, tick: this.tick, hz: TICK_HZ, snapEvery: SNAP_EVERY }));
        this.settle(changed);
        return conn.slot;
    }
    leave(conn) {
        if (!this.conns.delete(conn))
            return;
        if (conn === this.host) // seated players first, then whoever has been waiting longest
            this.host = [...this.conns].sort((a, b) => (b.team >= 0) - (a.team >= 0) || a.order - b.order)[0] || null;
        this.fillSeats(); // 2v2 lobby: a free seat goes to whoever has waited longest
        this.settle(this.reseat());
    }
    assign(cid, to) { // the host moves a member: 0 = Blue, 1 = Red, -1 = waiting
        const c = [...this.conns].find(x => x.cid === cid);
        if (!c || ![0, 1, -1].includes(to) || c.team === to)
            return;
        if (to >= 0 && this.teamCount(to) >= TEAM_MAX)
            return; // that team is full
        c.team = to;
        c.order = this.nextOrder++; // joins the end of that team's seat order
        this.settle(this.reseat());
    }
    start() {
        const sim = this.sim, ids = [];
        this.seats.forEach((c, i) => {
            if (!c)
                return;
            ids.push(i);
            sim.run('allPlayers[' + i + '].special2 = ' + JSON.stringify(c.special2)); // was never applied, so a second special chosen on joining was ignored
            sim.run(`allPlayers[${i}].special = '${c.special}'`); // before the restart, so a pick screen opens with the right choice highlighted
        });
        sim.run(`pickFixed = ${this.fixed}`);
        sim.run(`twoSpecials = ${this.twoSpecials}`);
        sim.run(`swapOn = ${this.swapSides}`);
        sim.run(`setRoster([${ids.join(',')}])`); // exactly these players; also restarts the match (and opens the first pick screen when they are on)
        sim.ctx.__ev.length = 0;
        this.tick = 0;
        this.acc = 0;
        this.last = performance.now();
        this.running = true;
        this.snapshot(); // everyone sees the fresh board straight away
    }
    setSpecial(conn, id, slot = 0) {
        if (!SPECIAL_IDS.includes(id) || this.fixed)
            return;
        const a = slot === 1 ? 'special2' : 'special', b = slot === 1 ? 'special' : 'special2';
        if (this.twoSpecials && conn[b] === id)
            conn[b] = conn[a]; // picking the one in the other slot swaps them
        conn[a] = id;
        if (conn.special2 === conn.special) // (two specials off: keep the invariant anyway)
            conn.special2 = SPECIAL_IDS.find(s => s !== conn.special);
        if (conn.slot >= 0) // remembered on the connection, so it follows the player if they are moved
            this.sim.run(`allPlayers[${conn.slot}].special = '${conn.special}'; allPlayers[${conn.slot}].special2 = '${conn.special2}'`);
    }
    setTwoSpecials(v) { // restarts the match
        this.twoSpecials = !!v;
        this.sim.run(`twoSpecials = ${this.twoSpecials}`);
        if (this.running)
            this.start();
    }
    setFixed(v) { // the "pick screens" option: restarts the match so everyone starts from the first pick screen
        this.fixed = !!v;
        this.sim.run(`pickFixed = ${this.fixed}`);
        if (this.running)
            this.start();
    }
    setSwap(v) { // the "switch sides" option: restarts the match so everyone starts from the normal sides
        this.swapSides = !!v;
        this.sim.run(`swapOn = ${this.swapSides}`);
        if (this.running)
            this.start();
    }
    say(text, only) { // a note in everybody's chat (or just `only`'s)
        const msg = JSON.stringify({ t: 'chat', sys: true, text });
        for (const c of only ? [only] : this.conns)
            c.send(msg);
    }
    rankedOk() { // can the current match be rated? accounts on, both teams seated, everybody seated signed in with a name, nobody sitting twice
        if (!accounts.enabled())
            return false;
        const seated = this.seats.filter(Boolean), ids = seated.map(c => c.uid);
        return this.teamCount(0) >= 1 && this.teamCount(1) >= 1 && seated.every(c => c.uid && c.name) && new Set(ids).size === ids.length;
    }
    setRanked(conn, v) { // the host's Ranked switch. Either way it restarts the match, so a ranked match always starts at 0-0.
        v = !!v;
        if (v === this.ranked)
            return;
        if (v && !this.rankedOk())
            return this.say('Ranked needs everyone seated to be signed in with a name.', conn);
        this.ranked = v;
        this.say(v ? 'The host turned Ranked on: this match counts toward ratings. The match restarts.' : 'The host turned Ranked off: casual match. The match restarts.');
        if (this.running)
            this.start();
        this.roster(); // carries the new setting
    }
    setLobby2v2(v) { // the host's 2v2 switch. On: everyone already waiting takes the open seats and the match waits for all four. Off: back to host-placed teams; nobody is moved off a team.
        this.lobby2v2 = !!v;
        this.fillSeats();
        this.settle(this.reseat());
    }
    chat(conn, raw) { // relay one chat message to everybody in the room (the sender included, so everyone sees the same order)
        if (typeof raw !== 'string')
            return;
        const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
        if (!text)
            return;
        const now = Date.now();
        conn.chatAt = (conn.chatAt || []).filter(t => now - t < CHAT_WINDOW_MS);
        if (conn.chatAt.length >= CHAT_BURST)
            return conn.send(JSON.stringify({ t: 'chat', sys: true, text: 'Slow down: too many messages.' }));
        conn.chatAt.push(now);
        const msg = JSON.stringify({ t: 'chat', c: conn.cid, team: conn.team, text });
        for (const c of this.conns)
            c.send(msg);
    }
    roster() {
        const members = [...this.conns]
            .sort((a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.order - b.order) // seated by seat, then the waiting list in order
            .map(c => ({ c: c.cid, team: c.team, slot: c.slot, host: c === this.host, name: c.name || null, skin: c.skin && c.skin.length ? c.skin : null }));
        const base = { t: 'roster', slots: this.seats.map(Boolean), spectators: members.filter(m => m.slot < 0).length, running: this.running, lobby2v2: this.lobby2v2, ranked: this.ranked, members };
        for (const c of this.conns)
            c.send(JSON.stringify({ ...base, host: c === this.host, you: c.cid }));
    }
    advance(now) {
        if (!this.running) {
            this.last = now;
            return;
        }
        this.acc += now - this.last;
        this.last = now;
        const ctx = this.sim.ctx;
        let n = 0;
        while (this.acc >= DT_MS && n < MAX_CATCHUP) {
            for (let i = 0; i < 4; i++)
                ctx.__setKeys(i, this.bits[i]);
            ctx.__tick = this.tick + 1; // events are tagged with the tick count at which their effect is first visible
            ctx.update();
            if (ctx.__done) { // a point just won the match: rate it
                const done = ctx.__done;
                ctx.__done = null;
                this.matchOver(done);
            }
            this.tick++;
            n++;
            this.tpsN++;
            this.acc -= DT_MS;
            if (this.tick % SNAP_EVERY === 0)
                this.snapshot();
        }
        if (this.acc > DT_MS * MAX_CATCHUP)
            this.acc = 0;
        if (now - this.tpsT >= 1000) {
            this.tps = Math.round(this.tpsN * 1000 / (now - this.tpsT));
            this.tpsN = 0;
            this.tpsT = now;
        }
    }
    snapshot() {
        const ctx = this.sim.ctx;
        const s = JSON.stringify(ctx.saveState()), evNew = ctx.__ev.slice();
        ctx.__ev.length = 0;
        const evJson = JSON.stringify(evNew);
        const out = (c, ack) => {
            if (c.backlog() > SNAP_BACKLOG) { // not keeping up: skip this one, but keep its effects for the next one it gets
                c.heldEv = (c.heldEv || []).concat(evNew).slice(-80);
                return;
            }
            let ev = evJson;
            if (c.heldEv) {
                ev = JSON.stringify(c.heldEv.concat(evNew));
                c.heldEv = null;
            }
            c.send('{"t":"snap","tick":' + this.tick + ',"ack":' + ack + ',"s":' + s + ',"ev":' + ev + '}');
        };
        this.seats.forEach((c, i) => c && out(c, this.seq[i]));
        for (const c of this.conns)
            if (c.slot < 0)
                out(c, 0);
    }
    matchOver(done) { // Blue sits in seats 0 and 2, Red in 1 and 3. Rated only if everyone seated is signed in (accounts.recordMatch checks that).
        if (!this.ranked || !accounts.enabled())
            return;
        const teams = [0, 1].map(t => this.seats.filter((c, i) => c && i % 2 === t).map(c => c.uid || null));
        accounts.recordMatch({ teams, score: done.score });
    }
}

const SERVE_STATIC = process.env.SERVE_STATIC !== '0'; // set SERVE_STATIC=0 on Render
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); // e.g. https://wdb.pages.dev
function cors(req, res) {
    const o = req.headers.origin;
    if (o && ALLOWED_ORIGINS.includes(o)) {
        res.setHeader('Access-Control-Allow-Origin', o);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
}

function startServer(port = 8080, host = '0.0.0.0') {
    accounts.init();
    const rooms = new Map();
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
    const server = http.createServer((req, res) => { // plain static file server for the game itself (never the server code, tests or dotfiles)
        let p;
        try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
        if (p === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
            return;
        }
        if (p.startsWith('/api/')) {
            cors(req, res);
            if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; } // preflight (the Authorization header triggers one)
            accounts.handleApi(req, res, p);
            return;
        }
        if (!SERVE_STATIC) { res.writeHead(404).end('not found'); return; }
        if (p === '/')
            p = '/index.html';
        const parts = p.split('/').filter(Boolean);
        if (parts.some(s => s === '..' || s.startsWith('.') || s === 'server' || s === 'test' || s === 'node_modules')) {
            res.writeHead(403).end('forbidden');
            return;
        }
        const file = path.join(ROOT, ...parts);
        if (!file.startsWith(ROOT + path.sep)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        fs.stat(file, (err, st) => {
            if (err || !st.isFile()) {
                res.writeHead(404).end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            fs.createReadStream(file).pipe(res);
        });
    });

    attachWebSocket(server, conn => {
        let room = null, joining = false, gone = false, count = 0, since = Date.now();
        conn.on('message', async str => {
            const now = Date.now();
            if (now - since > 1000) { since = now; count = 0; }
            if (++count > MSG_PER_SEC)
                return conn.close(1008); // flooding
            let m;
            try { m = JSON.parse(str); } catch (e) { return; }
            if (!m || typeof m.t !== 'string')
                return;
            if (m.t === 'join' && !room && !joining) {
                joining = true;
                const id = m.token && accounts.enabled() ? await accounts.identify(m.token).catch(() => null) : null; // a bad or expired token just means guest
                joining = false;
                if (gone)
                    return;
                conn.uid = id ? id.uid : null;
                conn.name = id && id.name ? id.name : null;
                conn.skin = id ? id.skin : []; // (already cleaned by accounts.js)
                const name = typeof m.room === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(m.room) ? m.room : 'lobby';
                let r = rooms.get(name);
                if (!r) {
                    if (rooms.size >= MAX_ROOMS)
                        return conn.send(JSON.stringify({ t: 'error', msg: 'server is full' }));
                    rooms.set(name, r = new Room(name));
                    r.lobby2v2 = m.lobby2v2 === true; // the creator can open the room as a 2v2 lobby from the start
                }
                if (r.join(conn, m.special, m.special2) === -2) {
                    if (r.empty)
                        rooms.delete(name);
                    return conn.send(JSON.stringify({ t: 'error', msg: 'room is full' }));
                }
                room = r;
            } else if (m.t === 'in' && room && conn.slot >= 0) { // (conn.slot follows the host moving people around)
                if (Number.isInteger(m.k) && m.k >= 0 && m.k <= 255) {
                    room.bits[conn.slot] = m.k;
                    if (Number.isInteger(m.n))
                        room.seq[conn.slot] = m.n;
                }
            } else if (m.t === 'sp' && room)
                room.setSpecial(conn, m.s, m.slot === 1 ? 1 : 0);
            else if (m.t === 'two' && room && room.host === conn)
                room.setTwoSpecials(m.v);
            else if (m.t === 'fixed' && room && room.host === conn)
                room.setFixed(m.v);
            else if (m.t === 'swap' && room && room.host === conn)
                room.setSwap(m.v);
            else if (m.t === 'ranked' && room && room.host === conn)
                room.setRanked(conn, m.v);
            else if (m.t === 'lobby2v2' && room && room.host === conn)
                room.setLobby2v2(m.v);
            else if (m.t === 'assign' && room && room.host === conn)
                room.assign(Number(m.c), Number(m.to));
            else if (m.t === 'chat' && room)
                room.chat(conn, m.text);
            else if (m.t === 'refresh' && room && conn.uid && typeof m.token === 'string') {
                accounts.identify(m.token).then(id => { // only the same account may refresh its own seat; a different or bad token changes nothing
                    if (!id || id.uid !== conn.uid || gone)
                        return;
                    conn.name = id.name || conn.name;
                    conn.skin = id.skin;
                    room.roster();
                }).catch(() => {});
            } else if (m.t === 'ping')
                conn.send(JSON.stringify({ t: 'pong', c: Number(m.c) || 0, tick: room ? room.tick : 0, tps: room ? room.tps : 0 }));
        });
        conn.on('close', () => {
            gone = true;
            if (!room)
                return;
            room.leave(conn);
            if (room.empty)
                rooms.delete(room.name);
        });
    });

    const loop = setInterval(() => {
        const now = performance.now();
        for (const r of rooms.values())
            r.advance(now);
    }, 4);
    server.on('close', () => clearInterval(loop));

    return new Promise(resolve => server.listen(port, host, () => resolve({ server, rooms, port: server.address().port, close: () => new Promise(r => { clearInterval(loop); for (const rm of rooms.values()) rm.everyone.forEach(c => c.close(1001)); server.close(r); server.closeAllConnections?.(); }) })));
}

module.exports = { startServer };

if (require.main === module) {
    const port = +(process.argv[2] || process.env.PORT || 8080);
    startServer(port, process.env.HOST || '0.0.0.0').then(s => {
        console.log(`Weird Death Ball server listening on port ${s.port}`);
        console.log(`  play:  http://localhost:${s.port}/?room=test   (open it in two tabs or two machines on your network)`);
        console.log('  stop:  Ctrl+C');
    });
}


