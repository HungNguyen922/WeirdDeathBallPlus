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
//                      {t:'in', n, k}                      my keys changed. n = my input counter, k = bit mask: l1 r2 up4 dn8 z16 x32 sp64   (z = grapple, x = weight, sp = special)
//                      {t:'sp', s}                         equip special ability s (ignored while pick screens are on)
//                      {t:'fixed', v}                      host only: specials only on pick screens (true) or free swapping (false); restarts the match
//                      {t:'swap', v}                       host only: switch sides every 5 points (true) or never (false); restarts the match
//                      {t:'lobby2v2', v}                   host only: 2v2 lobby on (newcomers fill Blue, Red, Blue 2, Red 2 and the match waits for all four seats) or off
//                      {t:'assign', c, to}                 host only: move member c to team 0 (Blue), 1 (Red) or -1 (waiting); restarts the match if seats change
//                      {t:'ping', c}                       latency probe
//   server -> client   {t:'welcome', room, slot, cid, tick, hz, snapEvery}   slot: 0..3 = a seat, -1 = waiting / spectating; cid = your member id
//                      {t:'slot', slot}                    your seat changed (the host moved you)
//                      {t:'roster', slots:[bool x4], spectators, running, lobby2v2, host, you, members:[{c, team, slot, host}]}
//                      {t:'snap', tick, ack, s, ev}         s = saveState(), ack = my last input counter the server has applied, ev = [[name, tick, ...args], ...]
//                      {t:'pong', c, tick, tps}    {t:'error', msg}
const http = require('http'), fs = require('fs'), path = require('path');
const { attachWebSocket } = require('./ws.js');
const { loadSim, ROOT } = require('./sim-node.js');

const TICK_HZ = 120, DT_MS = 1000 / TICK_HZ, SNAP_EVERY = 4; // snapshots at 30 Hz
const MAX_CATCHUP = 8; // never run more than this many ticks in one go (after a stall, drop the debt instead of spiralling)
const MAX_ROOMS = 50, MAX_SPECTATORS = 8, MSG_PER_SEC = 400;
const TEAM_MAX = 2; // players per team (seats 0 / 2 are Blue, 1 / 3 are Red)
const SPECIAL_IDS = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat', 'barbwire', 'warp', 'awakened', 'explode'];

// Code that runs INSIDE a room's sandbox: it captures the game's events (the renderer's hooks) into a list, and applies input bits to a player's keys.
const ROOM_PRELUDE = `
var __ev = [], __tick = 0;
const __ref = b => b === ball ? 'b' : b instanceof Player ? 'p' + b.id : 'd' + decoys.indexOf(b);
events.onPoint = (team, why) => __ev.push(['pt', __tick, team, why]);
events.onNewRound = () => __ev.push(['nr', __tick]);
events.onImpact = (p, x, y, ux, uy, v) => __ev.push(['im', __tick, p.id, x, y, ux, uy, v]);
events.onBatHit = (p, b, x, y, ux, uy, k) => __ev.push(['bt', __tick, p.id, __ref(b), x, y, ux, uy, k]);
function __setKeys(i, bits) {
    const k = allPlayers[i].keys;
    k.l = !!(bits & 1); k.r = !!(bits & 2); k.up = !!(bits & 4); k.dn = !!(bits & 8); k.z = !!(bits & 16); k.x = !!(bits & 32); k.sp = !!(bits & 64);
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
        this.swapSides = true; // the host's "switch sides every 5 points" option
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
    join(conn, special) {
        let team = this.lobby2v2 ? this.openTeam() : [0, 1].find(t => this.teamCount(t) === 0); // a 2v2 lobby seats newcomers anywhere there is room; otherwise a team with nobody on it, and later arrivals wait for the host
        if (team === undefined)
            team = -1;
        if (team < 0 && [...this.conns].filter(c => c.team < 0).length >= MAX_SPECTATORS)
            return -2;
        conn.cid = this.nextCid++;
        conn.team = team;
        conn.order = this.nextOrder++;
        conn.special = SPECIAL_IDS.includes(special) ? special : 'dash';
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
            sim.run(`allPlayers[${i}].special = '${c.special}'`); // before the restart, so a pick screen opens with the right choice highlighted
        });
        sim.run(`pickFixed = ${this.fixed}`);
        sim.run(`swapOn = ${this.swapSides}`);
        sim.run(`setRoster([${ids.join(',')}])`); // exactly these players; also restarts the match (and opens the first pick screen when they are on)
        sim.ctx.__ev.length = 0;
        this.tick = 0;
        this.acc = 0;
        this.last = performance.now();
        this.running = true;
        this.snapshot(); // everyone sees the fresh board straight away
    }
    setSpecial(conn, id) {
        if (!SPECIAL_IDS.includes(id) || this.fixed)
            return;
        conn.special = id; // remembered, so it follows the player if they are moved
        if (conn.slot >= 0)
            this.sim.run(`allPlayers[${conn.slot}].special = '${id}'`);
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
    setLobby2v2(v) { // the host's 2v2 switch. On: everyone already waiting takes the open seats and the match waits for all four. Off: back to host-placed teams; nobody is moved off a team.
        this.lobby2v2 = !!v;
        this.fillSeats();
        this.settle(this.reseat());
    }
    roster() {
        const members = [...this.conns]
            .sort((a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.order - b.order) // seated by seat, then the waiting list in order
            .map(c => ({ c: c.cid, team: c.team, slot: c.slot, host: c === this.host }));
        const base = { t: 'roster', slots: this.seats.map(Boolean), spectators: members.filter(m => m.slot < 0).length, running: this.running, lobby2v2: this.lobby2v2, members };
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
        const s = JSON.stringify(ctx.saveState()), ev = JSON.stringify(ctx.__ev);
        ctx.__ev.length = 0;
        const head = `{"t":"snap","tick":${this.tick},"ack":`, tail = `,"s":${s},"ev":${ev}}`;
        this.seats.forEach((c, i) => c && c.send(head + this.seq[i] + tail));
        for (const c of this.conns)
            if (c.slot < 0)
                c.send(head + '0' + tail);
    }
}

function startServer(port = 8080, host = '0.0.0.0') {
    const rooms = new Map();
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
    const server = http.createServer((req, res) => { // plain static file server for the game itself (never the server code, tests or dotfiles)
        let p;
        try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
        if (p === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
            return;
        }
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
        let room = null, count = 0, since = Date.now();
        conn.on('message', str => {
            const now = Date.now();
            if (now - since > 1000) { since = now; count = 0; }
            if (++count > MSG_PER_SEC)
                return conn.close(1008); // flooding
            let m;
            try { m = JSON.parse(str); } catch (e) { return; }
            if (!m || typeof m.t !== 'string')
                return;
            if (m.t === 'join' && !room) {
                const name = typeof m.room === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(m.room) ? m.room : 'lobby';
                let r = rooms.get(name);
                if (!r) {
                    if (rooms.size >= MAX_ROOMS)
                        return conn.send(JSON.stringify({ t: 'error', msg: 'server is full' }));
                    rooms.set(name, r = new Room(name));
                    r.lobby2v2 = m.lobby2v2 === true; // the creator can open the room as a 2v2 lobby from the start
                }
                if (r.join(conn, m.special) === -2) {
                    if (r.empty)
                        rooms.delete(name);
                    return conn.send(JSON.stringify({ t: 'error', msg: 'room is full' }));
                }
                room = r;
            } else if (m.t === 'in' && room && conn.slot >= 0) { // (conn.slot follows the host moving people around)
                if (Number.isInteger(m.k) && m.k >= 0 && m.k <= 127) {
                    room.bits[conn.slot] = m.k;
                    if (Number.isInteger(m.n))
                        room.seq[conn.slot] = m.n;
                }
            } else if (m.t === 'sp' && room)
                room.setSpecial(conn, m.s);
            else if (m.t === 'fixed' && room && room.host === conn)
                room.setFixed(m.v);
            else if (m.t === 'swap' && room && room.host === conn)
                room.setSwap(m.v);
            else if (m.t === 'lobby2v2' && room && room.host === conn)
                room.setLobby2v2(m.v);
            else if (m.t === 'assign' && room && room.host === conn)
                room.assign(Number(m.c), Number(m.to));
            else if (m.t === 'ping')
                conn.send(JSON.stringify({ t: 'pong', c: Number(m.c) || 0, tick: room ? room.tick : 0, tps: room ? room.tps : 0 }));
        });
        conn.on('close', () => {
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
