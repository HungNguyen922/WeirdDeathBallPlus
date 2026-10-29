// Tests for skins: the validator (js/skin-data.js), the account API (POST /api/skin, against a small fake Firestore) and the room roster that carries skins to the other players.
// Run:  node js/test/skin-test.js        (needs no Firebase account: firebase-admin is replaced by an in-memory fake for this test only)
const Module = require('module'), { EventEmitter } = require('events');
const { skinClean, SKIN_MAX_LAYERS, SKIN_SHAPES } = require('../skin-data.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const layer = (o = {}) => ({ t: 'oval', x: 0.1, y: -0.2, w: 0.4, h: 0.3, r: 15, c: '#ff8800', o: 0, ...o });

console.log('\nthe validator');
{
    check(JSON.stringify(skinClean([layer()])) === JSON.stringify([layer()]), 'a good layer comes through unchanged');
    check(skinClean('nope').length === 0 && skinClean(null).length === 0 && skinClean({ 0: layer() }).length === 0 && skinClean(undefined).length === 0, 'anything that is not a list gives an empty skin');
    check(skinClean([layer({ t: 'skull' }), layer({ t: '__proto__' }), layer({ t: 5 })]).length === 0, 'unknown shapes are dropped');
    check(skinClean([layer({ c: 'red' }), layer({ c: '#fff' }), layer({ c: '#ff00zz' }), layer({ c: 'javascript:alert(1)' }), layer({ c: 255 }), layer({ c: '#ff0000; x' })]).length === 0, 'colours must be #rrggbb, nothing else');
    check(skinClean([layer({ c: '#AABBCC' })])[0].c === '#aabbcc', 'colours are lower-cased');
    const wild = skinClean([layer({ x: 99, y: -99, w: 50, h: -3, r: 9000 })])[0];
    check(wild.x === 1.6 && wild.y === -1.6 && wild.w === 2 && wild.h === 0.05 && wild.r === 180, 'numbers are clamped into range (' + JSON.stringify(wild) + ')');
    const bad = skinClean([layer({ x: NaN, y: Infinity, w: '5', h: null, r: undefined })])[0];
    check(bad.x === 0 && bad.y === 0 && bad.w === 0.4 && bad.h === 0.4 && bad.r === 0, 'NaN, Infinity, strings and nulls fall back to defaults');
    check(skinClean([layer({ o: 'yes' }), layer({ o: 0 })]).map(l => l.o).join() === '1,0', 'o is always 0 or 1');
    const many = Array.from({ length: 100 }, () => layer());
    check(skinClean(many).length === SKIN_MAX_LAYERS, `at most ${SKIN_MAX_LAYERS} layers`);
    check(skinClean([null, 5, 'x', [], layer()]).length === 1, 'junk entries are skipped, the good one stays');
    const sneaky = skinClean([{ ...layer(), evil: 'x'.repeat(5000), __proto__: { polluted: 1 }, constructor: 'c' }])[0];
    check(Object.keys(sneaky).sort().join() === 'c,h,o,r,t,w,x,y' && !({}).polluted, 'unknown keys are thrown away, nothing leaks into Object.prototype');
    check(SKIN_SHAPES.every(t => skinClean([layer({ t })]).length === 1), 'every listed shape is accepted');
    check(JSON.stringify(skinClean(skinClean(many))) === JSON.stringify(skinClean(many)), 'cleaning twice changes nothing');
    check(JSON.stringify(skinClean(many)).length < 4000, `a full skin is small (${JSON.stringify(skinClean(many)).length} bytes)`);
}

// ---- an in-memory stand-in for Firestore + Firebase Auth, so the real accounts.js can run ----
const store = new Map(); // 'players/uid' -> data
const fakeDb = {
    collection: name => ({ doc: id => ({ path: name + '/' + id, get: async () => ({ exists: store.has(name + '/' + id), data: () => store.get(name + '/' + id) }),
        set: async d => { store.set(name + '/' + id, { ...d }); }, update: async d => { store.set(name + '/' + id, { ...store.get(name + '/' + id), ...d }); }, delete: async () => { store.delete(name + '/' + id); } }) }),
    runTransaction: async fn => fn({ get: async ref => ref.get(), set: (ref, d) => { store.set(ref.path, { ...d }); }, update: (ref, d) => { store.set(ref.path, { ...store.get(ref.path), ...d }); }, delete: ref => { store.delete(ref.path); } })
};
const fakes = { 'firebase-admin/app': { initializeApp() {}, cert: x => x }, 'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async t => { if (!/^tok-/.test(t)) throw new Error('bad token'); return { uid: t.slice(4) }; } }) }, 'firebase-admin/firestore': { getFirestore: () => fakeDb } };
const realLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] || realLoad.call(this, req, ...rest); };
process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
const accounts = require('../server/accounts.js');
console.log('\nthe account API (fake Firestore)');
const api = (method, path, token, body) => new Promise(resolve => {
    const req = new EventEmitter(); req.method = method; req.headers = token ? { authorization: 'Bearer ' + token } : {};
    const res = { headersSent: false, writeHead(code) { this.code = code; return this; }, end(s) { this.headersSent = true; resolve({ code: this.code, body: JSON.parse(s) }); } };
    accounts.handleApi(req, res, path);
    setImmediate(() => { if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
});
(async () => {
    check(accounts.init() === true, 'accounts switch on with the fake Firebase');
    let r = await api('POST', '/api/skin', 'tok-ann', { skin: [layer()] });
    check(r.code === 400 && /name/i.test(r.body.error), 'saving a skin before choosing a name is refused (' + r.body.error + ')');
    r = await api('POST', '/api/name', 'tok-ann', { name: 'Ann_1' });
    check(r.code === 200 && Array.isArray(r.body.profile.skin) && r.body.profile.skin.length === 0, 'a new profile starts with an empty skin');
    r = await api('POST', '/api/skin', null, { skin: [layer()] });
    check(r.code === 401, 'saving a skin needs a sign-in');
    r = await api('POST', '/api/skin', 'tok-ann', { skin: [layer({ c: '#00ff00' }), layer({ t: 'skull' }), layer({ x: 50 })] });
    check(r.code === 200 && r.body.skin.length === 2 && r.body.skin[1].x === 1.6, 'the server stores the CLEANED skin and answers with it (' + r.body.skin.length + ' layers)');
    check(store.get('players/ann').skin.length === 2, 'it is in the profile document');
    r = await api('POST', '/api/skin', 'tok-ann', { skin: 'not a list' });
    check(r.code === 400 && store.get('players/ann').skin.length === 2, 'a non-list is refused and the old skin stays');
    r = await api('POST', '/api/skin', 'tok-ann', { skin: [] });
    check(r.code === 200 && store.get('players/ann').skin.length === 0, 'an empty list clears the skin');
    r = await api('POST', '/api/skin', 'tok-ann', { skin: Array.from({ length: 5000 }, () => layer()) });
    check(r.code === 400, 'an oversized request is refused before it is parsed (' + r.code + ')');
    store.set('players/ann', { ...store.get('players/ann'), skin: [{ t: 'skull', c: 'red' }, layer()] }); // a damaged document must never reach other players
    r = await api('GET', '/api/me', 'tok-ann');
    check(r.code === 200 && r.body.profile.skin.length === 1, 'a damaged stored skin is cleaned on the way out too');
    await api('POST', '/api/skin', 'tok-ann', { skin: [layer({ c: '#123456' })] });
    check((await accounts.identify('tok-ann')).skin[0].c === '#123456' && (await accounts.identify('tok-nobody')).skin.length === 0 && (await accounts.identify('bad')) === null, 'identify() returns the skin for a join (empty for a profile-less account, null for a bad token)');

    console.log('\nskins in the room roster');
    const { startServer } = require('../server/server.js');
    const srv = await startServer(0, '127.0.0.1'), port = srv.port;
    const client = (room, extra) => {
        const c = { roster: null };
        c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
        c.opened = new Promise(res => { c.ws.onopen = () => { c.send({ t: 'join', room, ...extra }); res(); }; });
        c.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'roster') c.roster = m; };
        c.send = o => c.ws.send(JSON.stringify(o));
        return c;
    };
    await api('POST', '/api/name', 'tok-bob', { name: 'Bob_2' });
    const a = client('sk', { token: 'tok-ann' }); await a.opened; await sleep(150);
    const g = client('sk', { skin: [layer({ c: '#ff0000' })] }); await g.opened; await sleep(150); // a guest who tries to hand the server a skin
    const memA = () => g.roster.members.find(m => m.name === 'Ann_1'), memG = () => g.roster.members.find(m => !m.name);
    check(memA() && memA().skin && memA().skin.length === 1 && memA().skin[0].c === '#123456', 'the roster carries the signed-in player\'s skin');
    check(memG() && memG().skin && memG().skin.length === 1 && memG().skin[0].c === '#ff0000', 'a guest\'s own skin comes through the join message (cleaned by the server)');
    await api('POST', '/api/skin', 'tok-ann', { skin: [layer({ c: '#abcdef' }), layer({ t: 'star' })] });
    a.send({ t: 'refresh', token: 'tok-ann' }); await sleep(250);
    check(memA().skin.length === 2 && memA().skin[0].c === '#abcdef', 'after a refresh everyone sees the new skin at once');
    await api('POST', '/api/skin', 'tok-ann', { skin: [layer({ c: '#0000ff' })] });
    g.send({ t: 'refresh', token: 'tok-ann' }); await sleep(250);
    check(memA().skin.length === 2, 'a guest cannot refresh somebody else\'s seat, even with their token');
    const b = client('sk', { token: 'tok-bob' }); await b.opened; await sleep(150);
    b.send({ t: 'refresh', token: 'tok-ann' }); await sleep(250);
    check(memA().skin.length === 2 && g.roster.members.find(m => m.name === 'Bob_2').skin === null, 'nor can another account (Bob sending Ann\'s token changes nothing)');
    a.send({ t: 'refresh', token: 'garbage' }); a.send({ t: 'refresh' }); a.send({ t: 'refresh', token: 5 }); await sleep(150);
    check(memA().skin.length === 2, 'bad refresh messages are ignored and the connection survives');
    await new Promise(res => { fetch(`http://127.0.0.1:${port}/js/skin-data.js`).then(r => { check(r.status === 200, 'the browser can download js/skin-data.js'); res(); }); });
    for (const c of [a, g, b]) c.ws.close();
    await srv.close();
    await sleep(400); // let every socket finish closing: quitting while they still are makes Node on Windows abort with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
    Module._load = realLoad;
    console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
    process.exitCode = fails ? 1 : 0; // (not process.exit: let Node leave by itself once everything is closed)
    setTimeout(() => process.exit(fails ? 1 : 0), 3000).unref(); // safety net in case something is still holding it open
})().catch(e => { console.error(e); process.exit(1); });
