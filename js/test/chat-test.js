// Integration test for room chat: messages reach everybody (the sender too), are cleaned and capped, are rate limited, and stay inside their own room.
// Run:  node js/test/chat-test.js
const { startServer } = require('../server/server.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(port, room) {
    const c = { chats: [], welcome: null };
    c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    c.opened = new Promise((res, rej) => { c.ws.onopen = () => { c.send({ t: 'join', room }); res(); }; c.ws.onerror = rej; });
    c.ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') c.welcome = m;
        else if (m.t === 'chat') c.chats.push(m);
    };
    c.send = o => c.ws.send(JSON.stringify(o));
    return c;
}
const join = async (port, room) => { const c = client(port, room); await c.opened; await sleep(100); return c; };

(async () => {
    const srv = await startServer(0, '127.0.0.1'), port = srv.port;
    const a = await join(port, 'c1'), b = await join(port, 'c1'), c = await join(port, 'c1'), other = await join(port, 'c2');

    console.log('\nsending and receiving');
    a.send({ t: 'chat', text: 'hello team' }); await sleep(100);
    check(b.chats.length === 1 && b.chats[0].text === 'hello team' && b.chats[0].c === a.welcome.cid, 'the other player gets it, tagged with the sender\'s member id');
    check(a.chats.length === 1 && a.chats[0].text === 'hello team', 'the sender gets it back (so everyone sees the same order)');
    check(a.chats[0].team === 0 && c.chats[0].team === 0 && c.welcome.slot === -1, 'it carries the sender\'s team (0 = Blue); waiting players receive it too');
    b.send({ t: 'chat', text: 'hi' }); await sleep(100);
    check(a.chats[1].team === 1 && c.chats[1].team === 1, 'Red\'s message is marked as team 1');
    c.send({ t: 'chat', text: 'spectator here' }); await sleep(100);
    check(a.chats[2].team === -1 && a.chats[2].text === 'spectator here', 'a waiting player can chat too (team -1)');
    check(other.chats.length === 0, 'a different room hears nothing');

    console.log('\ncleaning');
    a.send({ t: 'chat', text: '   spaced \n\t out\u0007   ' }); await sleep(100);
    check(b.chats[b.chats.length - 1].text === 'spaced out', 'control characters and extra spaces are squeezed out');
    const n = b.chats.length;
    a.send({ t: 'chat', text: '    ' }); a.send({ t: 'chat', text: 42 }); a.send({ t: 'chat' }); await sleep(100);
    check(b.chats.length === n, 'empty or non-text messages are dropped');
    a.send({ t: 'chat', text: 'x'.repeat(500) }); await sleep(100);
    check(b.chats[b.chats.length - 1].text.length === 120, 'long messages are cut to 120 characters');

    console.log('\nrate limit');
    const d = await join(port, 'c3'), e = await join(port, 'c3');
    for (let i = 0; i < 8; i++) d.send({ t: 'chat', text: 'spam ' + i });
    await sleep(200);
    const got = e.chats.filter(m => !m.sys), warn = d.chats.filter(m => m.sys);
    check(got.length === 5, `only 5 of 8 quick messages get through (${got.length})`);
    check(warn.length === 3 && e.chats.every(m => !m.sys), 'the spammer is told to slow down; nobody else sees that note');

    console.log('\nbefore joining');
    const lone = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise(r => { lone.onopen = r; });
    let heard = 0; lone.onmessage = () => heard++;
    lone.send(JSON.stringify({ t: 'chat', text: 'anyone?' })); await sleep(100);
    check(heard === 0, 'chatting without being in a room does nothing');

    [a, b, c, other, d, e].forEach(x => x.ws.close()); lone.close();
    await srv.close();
    console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
    process.exit(fails ? 1 : 0);
})();
