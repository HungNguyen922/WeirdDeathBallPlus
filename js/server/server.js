// SERVER - serves the game files and runs online matches.  Start:  node server/server.js [port]     then open  http://localhost:8080/?room=test  in two tabs.
//
// Model (authoritative host): the server owns the real simulation, one per room. Clients send only their key presses; the server steps the sim at the game's fixed rate and
// sends everybody a snapshot of the whole world (saveState) 30 times a second, plus the one-off events (goals, impacts, bat hits) the renderer needs for its effects.
//
// Protocol: JSON text messages over a WebSocket.
//   client -> server   {t:'join', room, special}          join a room (first free seat: 0 = Blue, 1 = Red; after that you watch)
//                      {t:'in', n, k}                      my keys changed. n = my input counter, k = bit mask: l1 r2 up4 dn8 z16 x32 sp64   (z = grapple, x = weight, sp = special)
//                      {t:'sp', s}                         equip special ability s
//                      {t:'ping', c}                       latency probe
//   server -> client   {t:'welcome', room, slot, tick, hz, snapEvery}   slot: 0 / 1 = a player, -1 = spectator
//                      {t:'roster', slots:[bool, bool], spectators, running}
//                      {t:'snap', tick, ack, s, ev}         s = saveState(), ack = my last input counter the server has applied, ev = [[name, tick, ...args], ...]
//                      {t:'pong', c, tick}    {t:'error', msg}
// The match runs only while both seats are filled; when someone leaves it pauses, and when the seat is filled again the match restarts.
const http = require('http'), fs = require('fs'), path = require('path');
const { attachWebSocket } = require('./ws.js');
const { loadSim, ROOT } = require('./sim-node.js');

const TICK_HZ = 120, DT_MS = 1000 / TICK_HZ, SNAP_EVERY = 4; // snapshots at 30 Hz
const MAX_CATCHUP = 8; // never run more than this many ticks in one go (after a stall, drop the debt instead of spiralling)
const MAX_ROOMS = 50, MAX_SPECTATORS = 8, MSG_PER_SEC = 400;
const SPECIAL_IDS = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat'];

// Code that runs INSIDE a room's sandbox: it captures the game's events (the renderer's hooks) into a list, and applies input bits to a player's keys.
const ROOM_PRELUDE = `
var __ev = [], __tick = 0;
const __ref = b => b === ball ? 'b' : b instanceof Player ? 'p' + b.id : 'd' + decoys.indexOf(b);
events.onPoint = (team, why) => __ev.push(['pt', __tick, team, why]);
events.onNewRound = () => __ev.push(['nr', __tick]);
events.onImpact = (p, x, y, ux, uy, v) => __ev.push(['im', __tick, p.id, x, y, ux, uy, v]);
events.onBatHit = (p, b, x, y, ux, uy, k) => __ev.push(['bt', __tick, p.id, __ref(b), x, y, ux, uy, k]);
function __setKeys(i, bits) {
    const k = players[i].keys;
    k.l = !!(bits & 1); k.r = !!(bits & 2); k.up = !!(bits & 4); k.dn = !!(bits & 8); k.z = !!(bits & 16); k.x = !!(bits & 32); k.sp = !!(bits & 64);
}
`;

class Room {
    constructor(name) {
        this.name = name;
        this.sim = loadSim();
        this.sim.run(ROOM_PRELUDE);
        this.seats = [null, null]; // connections
        this.watchers = new Set();
        this.bits = [0, 0]; // latest key mask per seat
        this.seq = [0, 0]; // latest input counter per seat (echoed back as `ack`)
        this.special = ['dash', 'dash'];
        this.tick = 0;
        this.running = false;
        this.acc = 0;
        this.last = performance.now();
        this.tps = 0; this.tpsN = 0; this.tpsT = performance.now(); // achieved sim ticks per second (should sit at 120)
    }
    get everyone() { return [...this.seats.filter(Boolean), ...this.watchers]; }
    get empty() { return !this.seats[0] && !this.seats[1] && this.watchers.size === 0; }
    join(conn, special) {
        let slot = this.seats.findIndex(s => !s);
        if (slot >= 0) {
            this.seats[slot] = conn;
            this.bits[slot] = 0;
            this.seq[slot] = 0;
            if (SPECIAL_IDS.includes(special))
                this.special[slot] = special;
        } else {
            if (this.watchers.size >= MAX_SPECTATORS)
                return -2;
            this.watchers.add(conn);
        }
        conn.send(JSON.stringify({ t: 'welcome', room: this.name, slot, tick: this.tick, hz: TICK_HZ, snapEvery: SNAP_EVERY }));
        if (this.seats[0] && this.seats[1] && !this.running)
            this.start();
        this.roster();
        if (!this.running && this.tick > 0)
            this.snapshot(); // a watcher joining a paused room still gets to see the board
        return slot;
    }
    leave(conn) {
        const i = this.seats.indexOf(conn);
        if (i >= 0) {
            this.seats[i] = null;
            this.bits[i] = 0;
            this.running = false; // the match waits for the seat to be filled
        } else
            this.watchers.delete(conn);
        this.roster();
    }
    start() {
        const sim = this.sim;
        sim.run('setTeamSize(1)'); // 1v1; also restarts the match
        for (let i = 0; i < 2; i++)
            sim.run(`players[${i}].special = '${this.special[i]}'`);
        sim.ctx.__ev.length = 0;
        this.tick = 0;
        this.acc = 0;
        this.last = performance.now();
        this.running = true;
        this.snapshot(); // everyone sees the fresh board straight away
    }
    setSpecial(slot, id) {
        if (slot < 0 || !SPECIAL_IDS.includes(id))
            return;
        this.special[slot] = id;
        this.sim.run(`players[${slot}].special = '${id}'`);
    }
    roster() {
        const m = JSON.stringify({ t: 'roster', slots: [!!this.seats[0], !!this.seats[1]], spectators: this.watchers.size, running: this.running });
        for (const c of this.everyone)
            c.send(m);
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
            ctx.__setKeys(0, this.bits[0]);
            ctx.__setKeys(1, this.bits[1]);
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
        for (const c of this.watchers)
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
        let room = null, slot = -2, count = 0, since = Date.now();
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
                }
                slot = r.join(conn, m.special);
                if (slot === -2) {
                    if (r.empty)
                        rooms.delete(name);
                    return conn.send(JSON.stringify({ t: 'error', msg: 'room is full' }));
                }
                room = r;
            } else if (m.t === 'in' && room && slot >= 0) {
                if (Number.isInteger(m.k) && m.k >= 0 && m.k <= 127) {
                    room.bits[slot] = m.k;
                    if (Number.isInteger(m.n))
                        room.seq[slot] = m.n;
                }
            } else if (m.t === 'sp' && room)
                room.setSpecial(slot, m.s);
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
