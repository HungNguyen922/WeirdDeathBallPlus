// Integration test for the room server: starts it on a free port and talks to it with real WebSocket clients (Node's built-in WebSocket, so no packages needed).
// Run:  node test/net-test.js
const { startServer } = require('../server/server.js');
const http = require('http');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BIT = { l: 1, r: 2, up: 4, dn: 8, z: 16, x: 32, sp: 64 };

function client(port) {
    const c = { msgs: [], snaps: [], welcome: null, roster: null, closed: false, errors: [] };
    c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    c.opened = new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = rej; });
    c.ws.onclose = () => { c.closed = true; };
    c.ws.onmessage = e => {
        const m = JSON.parse(e.data);
        c.msgs.push(m);
        if (m.t === 'welcome') c.welcome = m;
        else if (m.t === 'roster') c.roster = m;
        else if (m.t === 'snap') c.snaps.push({ ...m, at: performance.now() });
        else if (m.t === 'error') c.errors.push(m.msg);
    };
    c.send = o => c.ws.send(JSON.stringify(o));
    c.last = () => c.snaps[c.snaps.length - 1];
    return c;
}
const get = (port, p) => new Promise(res => http.get({ port, host: '127.0.0.1', path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', () => res({ status: 0 })));

(async () => {
    const srv = await startServer(0, '127.0.0.1');
    const port = srv.port;
    console.log('server on port', port);

    console.log('\nstatic files');
    check((await get(port, '/index.html')).status === 200, 'GET /index.html -> 200');
    check((await get(port, '/js/physics/constants.js')).status === 200, 'GET /js/physics/constants.js -> 200');
    check((await get(port, '/server/server.js')).status === 403, 'server code is not served (403)');
    check((await get(port, '/test/net-test.js')).status === 403, 'test code is not served (403)');
    check((await get(port, '/%2e%2e/%2e%2e/etc/passwd')).status !== 200, 'path traversal does not work');
    check((await get(port, '/nope.txt')).status === 404, 'missing file -> 404');
    check((await get(port, '/health')).status === 200, '/health -> 200');

    console.log('\njoining');
    const a = client(port), b = client(port), w = client(port);
    await Promise.all([a.opened, b.opened]);
    a.send({ t: 'join', room: 'r1', special: 'bat' });
    await sleep(50);
    check(a.welcome && a.welcome.slot === 0, 'first client gets seat 0 (Blue)');
    check(a.roster && a.roster.running === false, 'match waits while only one seat is filled');
    await sleep(150);
    check(a.snaps.length === 0, 'no snapshots while waiting for an opponent');
    b.send({ t: 'join', room: 'r1', special: 'plinko' });
    await sleep(60);
    check(b.welcome && b.welcome.slot === 1, 'second client gets seat 1 (Red)');
    check(a.roster.running && b.roster.running, 'match starts when both seats are filled');
    await w.opened;
    w.send({ t: 'join', room: 'r1' });
    await sleep(60);
    check(w.welcome && w.welcome.slot === -1, 'third client is a spectator');
    check(a.roster.spectators === 1, 'players are told about the spectator');

    console.log('\nsnapshots');
    a.snaps.length = 0; b.snaps.length = 0; w.snaps.length = 0;
    const t0 = performance.now();
    await sleep(1000);
    const dur = (performance.now() - t0) / 1000;
    const rate = a.snaps.length / dur;
    check(rate > 26 && rate < 34, `snapshot rate ~30 Hz (measured ${rate.toFixed(1)})`);
    check(a.snaps.every((s, i) => i === 0 || s.tick - a.snaps[i - 1].tick === 4), 'snapshot ticks advance by 4 (every 4th sim tick), none missing');
    const ticksPerSec = (a.last().tick - a.snaps[0].tick) / ((a.last().at - a.snaps[0].at) / 1000);
    check(Math.abs(ticksPerSec - 120) < 6, `server sim runs at 120 ticks/s (measured ${ticksPerSec.toFixed(1)})`);
    check(w.snaps.length > 20, 'spectator receives snapshots too');
    const s0 = a.last().s;
    check(s0.inMatch.length === 2 && s0.players[0].special === 'bat' && s0.players[1].special === 'plinko', 'snapshot has the match and each seat\'s chosen special');
    const bytes = JSON.stringify(a.last()).length;
    console.log(`  info snapshot size ~${bytes} bytes -> ~${(bytes * rate / 1024).toFixed(0)} KB/s per client`);

    console.log('\ninput');
    const x0 = a.last().s.players[0].x, bx0 = b.last().s.players[1].x;
    a.send({ t: 'in', n: 7, k: BIT.r });
    b.send({ t: 'in', n: 3, k: BIT.l });
    await sleep(700);
    const sa = a.last();
    check(sa.s.players[0].x > x0 + 20, `holding RIGHT moves Blue right (${x0.toFixed(0)} -> ${sa.s.players[0].x.toFixed(0)})`);
    check(sa.s.players[1].x < bx0 - 20, `holding LEFT moves Red left (${bx0.toFixed(0)} -> ${sa.s.players[1].x.toFixed(0)})`);
    check(sa.ack === 7 && b.last().ack === 3, 'each client gets its own input counter echoed back as ack');
    check(sa.s.players[0].keys.r === true && sa.s.players[0].keys.l === false, 'server applied the key bits');
    a.send({ t: 'in', n: 8, k: 0 });
    await sleep(100);
    check(a.last().s.players[0].keys.r === false, 'releasing the keys is applied');
    // a spectator's input is ignored
    const wx = w.last().s.players[0].x;
    w.send({ t: 'in', n: 1, k: BIT.r });
    await sleep(300);
    check(w.last().s.players[0].keys.r === false, 'a spectator cannot steer');

    console.log('\nspecial + ping + garbage');
    a.send({ t: 'sp', s: 'arrow' });
    await sleep(120);
    check(a.last().s.players[0].special === 'arrow', 'equipping a special is applied');
    a.send({ t: 'sp', s: 'rm -rf' });
    a.send({ t: 'in', n: 9, k: 99999 });
    a.send({ t: 'in', n: 'x', k: 'y' });
    a.ws.send('this is not json');
    a.ws.send('{"t":');
    a.send({ t: 'nonsense' });
    a.send(null);
    await sleep(120);
    check(a.last().s.players[0].special === 'arrow' && !a.closed, 'invalid messages are ignored and the connection survives');
    a.send({ t: 'ping', c: 12345 });
    await sleep(60);
    const pong = a.msgs.find(m => m.t === 'pong');
    check(pong && pong.c === 12345, 'ping -> pong echoes the client timestamp');

    console.log('\nevents');
    // drive Blue into the ball: Blue holds right for a while; collect any events that arrive
    a.send({ t: 'in', n: 10, k: BIT.r });
    await sleep(2500);
    const evs = a.snaps.flatMap(s => s.ev);
    check(Array.isArray(a.last().ev), 'snapshots carry an event list');
    console.log('  info events seen so far:', [...new Set(evs.map(e => e[0]))].join(',') || '(none)');

    console.log('\nleaving');
    b.ws.close();
    await sleep(150);
    check(a.roster.running === false && a.roster.slots[1] === false, 'when a player leaves, the match pauses and the roster says so');
    const before = a.snaps.length;
    await sleep(300);
    check(a.snaps.length === before, 'no snapshots while paused');
    const b2 = client(port);
    await b2.opened;
    b2.send({ t: 'join', room: 'r1' });
    await sleep(100);
    check(b2.welcome.slot === 1 && a.roster.running, 'a new player takes the free seat and the match restarts');
    check(b2.snaps.length > 0 && b2.snaps[0].tick <= 4, 'restarted match begins from tick 0');

    console.log('\nrooms are separate');
    const c1 = client(port), c2 = client(port);
    await Promise.all([c1.opened, c2.opened]);
    c1.send({ t: 'join', room: 'other' }); c2.send({ t: 'join', room: 'other' });
    await sleep(300);
    check(c1.welcome.slot === 0 && c2.welcome.slot === 0 + 1, 'a different room has its own seats');
    check(c1.last() && c1.last().s.players[0].x === 250 && c1.last().tick < 200, 'and its own, freshly started match (Blue still at its spawn, early tick)');

    console.log('\nfull room');
    const extra = [];
    for (let i = 0; i < 9; i++) { const e = client(port); extra.push(e); await e.opened; e.send({ t: 'join', room: 'r1' }); }
    await sleep(200);
    check(extra.some(e => e.errors.includes('room is full')), 'too many spectators are turned away');
    check(rate > 0, 'server still healthy');

    console.log('\nflood protection + oversize');
    const f = client(port); await f.opened; f.send({ t: 'join', room: 'flood' });
    for (let i = 0; i < 600; i++) f.send({ t: 'ping', c: i });
    await sleep(200);
    check(f.closed, 'a client flooding messages is disconnected');
    const big = client(port); await big.opened;
    big.ws.send('x'.repeat(70000));
    await sleep(200);
    check(big.closed, 'an oversized message closes the connection');

    console.log('\ncleanup');
    for (const c of [a, b, w, b2, c1, c2, f, big, ...extra]) try { c.ws.close(); } catch (e) {}
    await sleep(200);
    check(srv.rooms.size === 0, `empty rooms are removed (${srv.rooms.size} left)`);
    await srv.close();
    console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
