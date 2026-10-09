// TOUCH - on-screen controls for phones and tablets. Load after net/client.js (it uses `net`) and before menu.js / main.js.
//
// LEFT half of the screen: a floating, relative stick. Touch anywhere and that spot becomes the stick's centre; drag from it and the direction picks one of the 8 arrow-key
// combinations (right, down-right, down, ...). It only ever presses the four arrow keys (l / r / up / dn), exactly like the keyboard, so every special that reads the arrows
// (dash, marionette, bat, arrow aim ...) works unchanged. If you drag further than 1.5 stick radii the centre follows your thumb, like Roblox's dynamic thumbstick.
//   After you lift your thumb the centre is remembered for REUSE_MS. A touch that lands near it in that time counts as a press in that direction AT ONCE (no drag needed), so
//   tapping the same direction twice quickly is two fresh key presses: that is the arrow special's double-tap-to-snap aim, which the sim handles (ARROW_DBL_T).
// RIGHT half: three horizontal bands, top to bottom (BANDS): special, weight, grapple. Touching within a few pixels of the line between two bands presses both.
//
// It writes the same key flags the keyboard writes: offline into the TOUCH_SEAT player's keys, online into net.keys (and sends them). Nothing in the simulation knows about touch.
// Taps on the canvas's own buttons (the Menu tile, the special keycaps and their list) are left to the canvas click handler in input.js.
const touch = (() => {
    const TOUCH_SEAT = 0; // offline: which player the touch controls drive (0 = Blue, 1 = Red). Online they always drive your own seat.
    const BANDS = ['sp', 'x', 'z']; // right half, top to bottom: special, weight, grapple
    const SECTOR_KEYS = [['r'], ['r', 'dn'], ['dn'], ['l', 'dn'], ['l'], ['l', 'up'], ['up'], ['r', 'up']]; // 8 sectors, clockwise from "right" (screen y points down)
    const ACTS = ['l', 'r', 'up', 'dn', 'z', 'x', 'sp'];
    const REUSE_MS = 700; // how long the stick keeps its centre after the thumb lifts
    const HINT_MS = 6000; // how long the zone labels show after the touch controls first appear
    const HYST = 0.12; // radians of stickiness at the edge of a sector, so the direction does not flicker when the thumb sits on a boundary

    const seat = () => (net.on ? net.slot : TOUCH_SEAT);
    const root = document.getElementById('touchui'), stickEl = document.getElementById('stick'), knobEl = stickEl ? stickEl.querySelector('.knob') : null;
    const rotate = document.getElementById('rotate');
    if (!root || !stickEl || !knobEl)
        return { seat, releaseAll() {} };
    const zoneEls = [...root.querySelectorAll('.zone')], spLabel = root.querySelector('.zone[data-act=sp] span');

    const state = Object.fromEntries(ACTS.map(k => [k, false])); // what touch is holding down right now
    const pointers = new Map(); // right-half fingers: pointerId -> { acts: Set }
    const stick = { id: null, ax: 0, ay: 0, sector: null }; // the left-half finger; (ax, ay) = the stick's centre in screen pixels
    let anchor = null, ghostTimer = 0, hintTimer = 0, enabled = false, R = 48;
    const DEAD = () => R * 0.28, FOLLOW = () => R * 1.5;

    function resize() {
        R = Math.max(32, Math.min(64, Math.min(innerWidth, innerHeight) * 0.11));
        stickEl.style.setProperty('--R', R + 'px');
    }
    function enable() { // first touch (or a touch-first device): show the overlay and the hints
        if (enabled)
            return;
        enabled = true;
        document.body.classList.add('touch');
        resize();
        root.classList.add('hint');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => root.classList.remove('hint'), HINT_MS);
    }

    // ---- reading the thumb ----
    function sectorOf(dx, dy, cur) {
        const d = Math.hypot(dx, dy);
        if (d < (cur === null ? DEAD() : DEAD() * 0.7))
            return null;
        const a = Math.atan2(dy, dx);
        if (cur !== null) {
            const off = Math.atan2(Math.sin(a - cur * Math.PI / 4), Math.cos(a - cur * Math.PI / 4));
            if (Math.abs(off) < Math.PI / 8 + HYST)
                return cur; // still inside (or just outside) the sector we are in
        }
        return (Math.round(a / (Math.PI / 4)) + 8) % 8;
    }
    function zoneActs(y) { // which of the right-half bands a finger at height y is pressing (two when it is on the line between them)
        const h = innerHeight, b = h / 3, seam = Math.max(14, Math.min(40, h * 0.05));
        const i = Math.max(0, Math.min(2, Math.floor(y / b))), acts = new Set([BANDS[i]]);
        if (i > 0 && y - i * b < seam)
            acts.add(BANDS[i - 1]);
        if (i < 2 && (i + 1) * b - y < seam)
            acts.add(BANDS[i + 1]);
        return acts;
    }
    function moveStick(x, y) {
        let dx = x - stick.ax, dy = y - stick.ay, d = Math.hypot(dx, dy);
        if (d > FOLLOW()) { // dragged past the edge: the centre follows the thumb
            const k = (d - FOLLOW()) / d;
            stick.ax += dx * k;
            stick.ay += dy * k;
            dx = x - stick.ax;
            dy = y - stick.ay;
            d = FOLLOW();
        }
        stick.sector = sectorOf(dx, dy, stick.sector);
        stickEl.style.transform = `translate(${stick.ax}px,${stick.ay}px)`;
        const k = d > 0 ? Math.min(d, R) / d : 0;
        knobEl.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    }
    function startStick(e) {
        const now = performance.now();
        let ax = e.clientX, ay = e.clientY;
        if (anchor && now - anchor.t < REUSE_MS && Math.hypot(ax - anchor.x, ay - anchor.y) < R * 3) { // landed near the remembered centre: keep it
            ax = anchor.x;
            ay = anchor.y;
        }
        anchor = null;
        clearTimeout(ghostTimer);
        Object.assign(stick, { id: e.pointerId, ax, ay, sector: null });
        stickEl.classList.remove('ghost');
        stickEl.classList.add('on');
        moveStick(e.clientX, e.clientY); // a touch that lands off-centre presses its direction straight away
    }
    function endStick() {
        anchor = { x: stick.ax, y: stick.ay, t: performance.now() };
        stick.id = null;
        stick.sector = null;
        stickEl.classList.remove('on');
        stickEl.classList.add('ghost'); // the centre stays faintly visible while it can still be reused
        knobEl.style.transform = 'translate(0px,0px)';
        clearTimeout(ghostTimer);
        ghostTimer = setTimeout(() => { stickEl.classList.remove('ghost'); anchor = null; }, REUSE_MS);
    }

    // ---- turning fingers into key flags ----
    function apply(changed) {
        if (net.on) { // online: my keys go to the server (and the predictor), like netKeyEvent in net/client.js
            if (net.slot < 0)
                return;
            for (const k of changed)
                net.keys[k] = state[k];
            net.sendKeys();
            return;
        }
        const p = allPlayers[TOUCH_SEAT];
        if (!players.includes(p))
            return;
        for (const k of changed)
            p.keys[k] = state[k];
    }
    function refresh() {
        const want = Object.fromEntries(ACTS.map(k => [k, false]));
        if (stick.id !== null && stick.sector !== null)
            for (const k of SECTOR_KEYS[stick.sector])
                want[k] = true;
        for (const f of pointers.values())
            for (const a of f.acts)
                want[a] = true;
        const changed = ACTS.filter(k => state[k] !== want[k]);
        for (const k of changed)
            state[k] = want[k];
        if (changed.length)
            apply(changed);
        for (const z of zoneEls)
            z.classList.toggle('down', state[z.dataset.act]);
        const p = seat() >= 0 ? allPlayers[seat()] : null, sp = p && typeof SPECIALS !== 'undefined' ? SPECIALS.find(a => a.id === p.special) : null;
        if (spLabel)
            spLabel.textContent = sp ? sp.name : 'SPECIAL';
    }
    function releaseAll() {
        pointers.clear();
        if (stick.id !== null)
            endStick();
        refresh();
    }

    // ---- events ----
    const blocked = e => (rotate && getComputedStyle(rotate).display !== 'none')
        || (typeof gameMenu !== 'undefined' && gameMenu.isOpen())
        || !!(e.target && e.target.closest && e.target.closest('#menu'));
    function onDown(e) {
        if (e.pointerType !== 'touch')
            return;
        enable();
        if (blocked(e))
            return;
        const [ax, ay] = arenaPos(e);
        if (uiHit(ax, ay)) // the Menu tile, a special keycap or the open special list: the canvas click handler (input.js) deals with the tap
            return;
        e.preventDefault();
        if (typeof closeSpecialMenu === 'function')
            closeSpecialMenu(); // touching the field closes an open special list, like a click does
        if (e.clientX < innerWidth / 2) {
            if (stick.id !== null)
                return; // one thumb on the stick
            startStick(e);
        } else
            pointers.set(e.pointerId, { acts: zoneActs(e.clientY) });
        refresh();
    }
    function onMove(e) {
        if (e.pointerType !== 'touch')
            return;
        if (e.pointerId === stick.id) {
            e.preventDefault();
            moveStick(e.clientX, e.clientY);
            refresh();
        } else if (pointers.has(e.pointerId)) {
            e.preventDefault();
            pointers.get(e.pointerId).acts = zoneActs(e.clientY);
            refresh();
        }
    }
    function onUp(e) {
        if (e.pointerId === stick.id)
            endStick();
        pointers.delete(e.pointerId);
        refresh();
    }
    window.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', releaseAll); // losing focus must not leave a key stuck down
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    window.addEventListener('resize', resize);
    window.addEventListener('contextmenu', e => { if (enabled) e.preventDefault(); }); // no long-press menu in the middle of a game

    // portrait on a phone: the overlay asks for landscape; a tap dismisses it, and turning the phone brings it back next time
    if (rotate) {
        rotate.addEventListener('click', () => { rotate.hidden = true; });
        const mq = matchMedia('(orientation: portrait)');
        if (mq.addEventListener)
            mq.addEventListener('change', () => { rotate.hidden = false; });
    }

    resize();
    if (matchMedia('(pointer: coarse)').matches)
        enable();
    return { seat, releaseAll };
})();
