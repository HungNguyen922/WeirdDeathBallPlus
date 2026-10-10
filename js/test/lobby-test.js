// Integration test for the host's 2v2 lobby switch (room.lobby2v2): newcomers fill Blue, Red, Blue 2, Red 2 and the match waits for all four seats.
// Run:  node js/test/lobby-test.js
const { startServer } = require('../server/server.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(port, room, extra) {
    const c = { snaps: [], welcome: null, roster: null, slot: -2 };
    c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    c.opened = new Promise((res, rej) => { c.ws.onopen = () => { c.send({ t: 'join', room, ...extra }); res(); }; c.ws.onerror = rej; });
    c.ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { c.welcome = m; c.slot = m.slot; }
        else if (m.t === 'slot') c.slot = m.slot;
        else if (m.t === 'roster') c.roster = m;
        else if (m.t === 'snap') c.snaps.push(m);
    };
    c.send = o => c.ws.send(JSON.stringify(o));
    c.last = () => c.snaps[c.snaps.length - 1];
    return c;
}
const join = async (port, room, extra) => { const c = client(port, room, extra); await c.opened; await sleep(120); return c; };

(async () => {
    const srv = await startServer(0, '127.0.0.1'), port = srv.port;

    console.log('\nswitching a running 1v1 room to a 2v2 lobby');
    const a = await join(port, 'r1'), b = await join(port, 'r1'), c = await join(port, 'r1'), d = await join(port, 'r1');
    check(a.slot === 0 && b.slot === 1 && c.slot === -1 && d.slot === -1, 'by default the first two play and the rest wait');
    check(a.roster.lobby2v2 === false, 'roster says the lobby is not 2v2');
    b.send({ t: 'lobby2v2', v: true }); await sleep(150);
    check(c.slot === -1 && c.roster.lobby2v2 === false, 'a non-host cannot switch it on');
    a.send({ t: 'lobby2v2', v: true }); await sleep(250);
    check(c.slot === 2 && d.slot === 3, `the host switches it on: the waiting players take Blue 2 / Red 2 (seats ${c.slot}, ${d.slot})`);
    check(a.roster.lobby2v2 === true && a.roster.running === true, 'roster reports the 2v2 lobby and the match is running');
    check(a.last() && a.last().s.inMatch.length === 4, 'the match has four players');

    console.log('\nfull room, a fifth player, someone leaves');
    const e = await join(port, 'r1');
    check(e.slot === -1, 'a fifth player waits');
    d.ws.close(); await sleep(250);
    check(e.slot === 3 && a.roster.running === true, 'when a seated player leaves, the longest-waiting player takes the seat and the match carries on');

    console.log('\nswitching it off');
    a.send({ t: 'lobby2v2', v: false }); await sleep(200);
    check(a.roster.lobby2v2 === false && a.roster.running === true && c.slot === 2 && e.slot === 3, 'nobody is moved off a team when it is switched off');

    console.log('\na room that is a 2v2 lobby from the start');
    const h = await join(port, 'r2');
    h.send({ t: 'lobby2v2', v: true }); await sleep(150);
    const p2 = await join(port, 'r2');
    check(h.slot === 0 && p2.slot === 1 && h.roster.running === false, 'two players are seated but the match waits for four');
    const p3 = await join(port, 'r2');
    check(p3.slot === 2 && h.roster.running === false, 'the third takes Blue 2, still waiting');
    const p4 = await join(port, 'r2');
    await sleep(200);
    check(p4.slot === 3 && h.roster.running === true && h.last() && h.last().s.inMatch.join() === '0,1,2,3', 'the fourth takes Red 2 and the match starts as a real 2v2');
    p3.ws.close(); await sleep(250);
    check(h.roster.running === false, 'if someone leaves with nobody waiting, the match pauses until the seat is filled');

    console.log('\nthe room creator can open it as a 2v2 lobby in the join message');
    const k1 = await join(port, 'r3', { lobby2v2: true }), k2 = await join(port, 'r3', { lobby2v2: true });
    check(k1.roster.lobby2v2 === true && k2.slot === 1, 'a new room created with lobby2v2 is a 2v2 lobby straight away');
    const j1 = await join(port, 'r4'), j2 = await join(port, 'r4', { lobby2v2: true }), j3 = await join(port, 'r4');
    check(j1.roster.lobby2v2 === false && j3.slot === -1, 'the flag from a later joiner is ignored (only the creator decides)');

    [a, b, c, e, h, p2, p4, k1, k2, j1, j2, j3].forEach(x => x.ws.close());
    await srv.close();
    console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
    process.exit(fails ? 1 : 0);
})();
