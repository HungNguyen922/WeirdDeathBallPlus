// Test of the browser client (js/net/client.js) against a real server, with no browser: the client file runs in a sandbox next to the game's simulation files, with just
// enough stand-ins for the page (document, window, the renderer's effect hooks). Checks the parts a human would otherwise have to eyeball: that the drawn state moves smoothly,
// lags by about the interpolation delay, that effects fire at the sim's cadence, and that goals / restarts reach the renderer.  Run:  node test/client-test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const { startServer } = require('../server/server.js');
const { loadSim, ROOT } = require('../server/sim-node.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BIT = { l: 1, r: 2, up: 4, dn: 8, z: 16, x: 32, sp: 64 };

function makeBrowser(port, query) {
    const sim = loadSim(), ctx = sim.ctx;
    const els = {}, listeners = {};
    const el = id => els[id] || (els[id] = { id, textContent: '', classList: { add() {}, toggle() {} }, addEventListener() {} });
    Object.assign(ctx, {
        document: { getElementById: el, addEventListener() {}, hidden: false },
        window: { addEventListener: (n, f) => (listeners[n] = listeners[n] || []).push(f), dispatchEvent: e => (listeners[e.type] || []).forEach(f => f(e)) },
        location: { search: query || '', protocol: 'http:', host: '127.0.0.1:' + port, pathname: '/' },
        WebSocket, performance, setInterval, clearInterval, URLSearchParams, Event, console, prompt: () => 'x',
    });
    const counts = { body: 0, melt: 0, clear: 0, points: [], newRound: 0, impacts: 0, bats: 0 };
    ctx.__counts = counts;
    sim.run(`
        const cv = { focus() {} }; function closeSpecialMenu() {}
        const bindings = [[null, { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'up', ArrowDown: 'dn', x: 'z', c: 'x', z: 'sp' }], [null, { a: 'l', d: 'r', w: 'up', s: 'dn', f: 'z', g: 'x', h: 'sp' }]];
        function trailMelt() { __counts.melt++; }
        events.onBodyStep = () => { __counts.body++; };
        events.onPoint = (t, w) => { __counts.points.push([t, w]); };
        events.onNewRound = () => { __counts.newRound++; };
        events.onImpact = () => { __counts.impacts++; };
        events.onBatHit = () => { __counts.bats++; };
    `);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/net/client.js'), 'utf8'), ctx, { filename: 'js/net/client.js' });
    if (!process.env.NOPREDICT)
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/net/predict.js'), 'utf8'), ctx, { filename: 'js/net/predict.js' }); // prediction on, like the page
    return { sim, ctx, els, counts, net: sim.run('net'), listeners };
}

function rawClient(port, room) {
    const c = { welcome: null, roster: null, closed: false };
    c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    c.ws.onopen = () => c.ws.send(JSON.stringify({ t: 'join', room }));
    c.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'welcome') c.welcome = m; if (m.t === 'roster') c.roster = m; };
    c.ws.onclose = () => { c.closed = true; };
    c.send = o => c.ws.send(JSON.stringify(o));
    return c;
}

(async () => {
    const srv = await startServer(0, '127.0.0.1'), port = srv.port;

    console.log('\nconnecting (room given in the URL, like ?room=t1)');
    const B = makeBrowser(port, '?room=t1');
    await sleep(150);
    check(B.net.on && B.net.slot === 0, 'the page joins the room named in the URL and gets seat 0');
    check(/you are Blue.*waiting for an opponent/.test(B.els.netstatus.textContent), 'status line says it is waiting for an opponent: "' + B.els.netstatus.textContent + '"');
    const red = rawClient(port, 't1');
    await sleep(200);
    check(red.welcome && red.welcome.slot === 1, 'an opponent joins seat 1');
    check(/you are Blue/.test(B.els.netstatus.textContent) && !/waiting/.test(B.els.netstatus.textContent), 'status line drops the waiting note');

    console.log('\ndrawing');
    // run the page's frame loop at ~60 fps
    const frames = [];
    let running = true;
    const loop = setInterval(() => {
        const now = performance.now();
        B.net.frame(now);
        const buf = B.net.buf, newest = buf.length ? buf[buf.length - 1].tick : 0;
        frames.push({ now, x: B.sim.run('players[0].x'), cur: B.net.cur, newest, keyR: B.sim.run('players[0].keys.r') });
    }, 1000 / 60);
    await sleep(900);
    check(B.sim.run('players.length') === 2 && B.net.cur > 0, 'snapshots are being drawn (render tick ' + B.net.cur + ')');
    const lag = frames.slice(-30).map(f => f.newest - f.cur);
    const avgLagMs = lag.reduce((a, b) => a + b, 0) / lag.length * (1000 / 120);
    check(avgLagMs > 60 && avgLagMs < 200, `drawn state trails the newest snapshot by about the interpolation delay (${avgLagMs.toFixed(0)} ms)`);

    console.log('\neffects cadence');
    B.counts.body = 0;
    const t0 = performance.now();
    await sleep(1000);
    const bodiesPerSec = B.counts.body / ((performance.now() - t0) / 1000);
    const alive = B.sim.run('players.filter(p => p.alive).length');
    const expect = (alive + 1) * 120;
    check(bodiesPerSec > expect * 0.85 && bodiesPerSec < expect * 1.15, `trail samples fire once per sim tick per body (${bodiesPerSec.toFixed(0)}/s, expected ~${expect})`);

console.log('\nresponsiveness');
    {
        const y0 = B.sim.run('players[0].y'), t1 = performance.now();
        B.net.keys.up = true; B.net.sendKeys();
        while (performance.now() - t1 < 70) await sleep(5);
        const rise = y0 - B.sim.run('players[0].y');
        B.net.keys.up = false; B.net.sendKeys();
        if (process.env.NOPREDICT)
            console.log('  info without prediction my player rose ' + rise.toFixed(2) + ' u in 70 ms');
        else
            check(rise > 3, 'with prediction my jump shows within 70 ms of the key press, inside the 100 ms interpolation delay (rose ' + rise.toFixed(2) + ' u)');
        await sleep(1800); // land again
    }

    frames.length = 0;
    B.net.keys.r = true; B.net.sendKeys();
    await sleep(120);
    check(B.sim.run('players[0].keys.r') === true, 'my own key shows as pressed immediately (before the server round trip)');
    await sleep(1500);
    if (!process.env.NOPREDICT)
        check(B.sim.run('pred.state !== null && pred.tick > 0'), 'the predictor is running (predicted tick ' + B.sim.run('pred.tick') + ')');
    const xs = frames.map(f => f.x);
    const moved = xs.filter((x, i) => i > 0 && x !== xs[i - 1]).length;
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    const smooth = moved / (xs.length - 1);
    check(xs[xs.length - 1] > xs[0] + 40, `Blue moved right while RIGHT was held (${xs[0].toFixed(0)} -> ${xs[xs.length - 1].toFixed(0)})`);
    check(smooth > 0.9, `position changes on ${(smooth * 100).toFixed(0)}% of frames: interpolated (30 Hz snapshots shown raw would be ~50%)`);
    check(Math.max(...steps.map(Math.abs)) < 12, `no jumps: biggest per-frame move ${Math.max(...steps.map(Math.abs)).toFixed(1)} u`);
    { const run = steps.filter((_, i) => xs[i] < 420); check(run.every(s => s > -0.5), 'it never visibly steps backwards on the approach (worst ' + Math.min(...run).toFixed(2) + ' u; hitting the death ball at x~445 is a real collision, not smoothing)'); }

    console.log('\ngoals and deaths reach the renderer');
    // keep Blue running right: it hits the death ball and dies -> Red scores
    const deadline = performance.now() + 9000;
    while (performance.now() < deadline && !B.counts.points.length) await sleep(100);
    check(B.counts.points.length > 0, 'a point event arrives: ' + JSON.stringify(B.counts.points));
    check(B.counts.impacts > 0 || B.counts.points.length > 0, 'impact / point effects were triggered');
    const sc = B.sim.run('score');
    check(sc[0] + sc[1] >= 1, 'score is part of the drawn state: ' + JSON.stringify(sc));

    console.log('\nspecial');
    B.net.setSpecial('bat');
    await sleep(300);
    check(B.sim.run('players[0].special') === 'bat', 'my special is shown as bat (optimistically, then confirmed by the server)');
    check(B.net.pendingSpecial === null, 'the pending change clears once the server confirms');

    console.log('\nopponent leaves and a new one joins');
    const nrBefore = B.counts.newRound;
    red.ws.close();
    await sleep(200);
    check(!B.net.running && /waiting/.test(B.els.netstatus.textContent), 'status says waiting again');
    const red2 = rawClient(port, 't1');
    await sleep(500);
    check(B.net.running && B.counts.newRound > nrBefore, 'the new match reaches the renderer as a new round');
    check(B.net.buf.length > 0 && B.net.buf[B.net.buf.length - 1].tick < 200, 'the snapshot buffer restarted with the new match');

    console.log('\nblur releases keys');
    B.net.keys.r = true; B.net.sendKeys();
    B.listeners.blur.forEach(f => f({ type: 'blur' }));
    await sleep(200);
    check(!B.net.keys.r, 'losing focus clears held keys (and tells the server)');

    clearInterval(loop);
    console.log('\ninterpolation unit checks');
    const mix = B.sim.run('netMixState');
    const mk = (x, vx, extra) => ({ score: [0, 0], pause: 0, over: false, msg: '', teamSize: 1, saw: { t: 0, v: 0 }, padFlash: [0, 0], inMatch: [0, 1], players: [{ id: 0, x, y: 10, keys: { r: !!extra }, ang: 3.1 }, { id: 1, x: 500, y: 10, keys: {}, ang: 0 }], ball: { x, y: 5, th: 0 }, decoys: [], pegs: [], arrows: [] });
    const a = mk(100, 0), b = mk(140, 0, true);
    const h = mix(a, b, 0.25);
    check(Math.abs(h.players[0].x - 110) < 1e-9 && Math.abs(h.ball.x - 110) < 1e-9, 'numbers blend linearly');
    check(h.players[0].keys.r === false && mix(a, b, 0.75).players[0].keys.r === true, 'flags switch at the halfway point');
    const far = mk(900, 0); far.players[0].ang = -3.1;
    check(mix(a, far, 0.25).players[0].x === 100 && mix(a, far, 0.75).players[0].x === 900, 'a body that jumped far (respawn) is not slid across the arena');
    const c = mk(100, 0), d = mk(104, 0); d.players[0].ang = -3.1;
    const ang = mix(c, d, 0.5).players[0].ang;
    check(Math.abs(Math.abs(ang) - Math.PI) < 0.05, 'angles take the short way round (+3.1 -> -3.1 passes through PI, not 0): ' + ang.toFixed(3));
    const e = mk(100, 0); e.score = [1, 0]; e.msg = 'Blue scores!';
    check(mix(a, e, 0.25).score[0] === 0 && mix(a, e, 0.75).score[0] === 1, 'score switches, it is never fractional');

    for (const x of [red, red2]) try { x.ws.close(); } catch (er) {}
    try { B.net.ws.close(); } catch (er) {}
    await sleep(200);
    await srv.close();
    console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
