// MENU - the Menu panel with three tabs: Game (AI players, 2v2, how specials are chosen, special picker, music, online), Players (online: who is on which team, host controls) and
// Controls (key bindings for every player, plus touch controls on a phone).
// It is opened from the Menu tile on Blue's wall (drawn in render/special-menu.js, clicked in input.js) or with Esc, and closed with the X, a click on the backdrop, or Esc.
// Pure page UI: the buttons inside it are the same ones input.js, music.js and net/client.js already find by id (ai0..ai3, mode2v2, music, online), so nothing else changes.
// Load after the other scripts (touch.js too), before main.js.
const gameMenu = (() => {
    const menu = document.getElementById('menu'), canvas = document.getElementById('c'), pickEl = document.getElementById('specialpick'), pickBtn = document.getElementById('pickmode'), rosterEl = document.getElementById('roster');
    if (!menu)
        return { open() {}, close() {}, refresh() {}, isOpen: () => false };
    const pickTitle = pickBtn ? pickBtn.title : '';
    const tabs = [...menu.querySelectorAll('[role=tab]')], panels = [...menu.querySelectorAll('[data-panel]')];
    const isOpen = () => !menu.hidden;
    function showTab(name) {
        for (const t of tabs) {
            const on = t.dataset.tab === name;
            t.classList.toggle('on', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (const p of panels)
            p.hidden = p.dataset.panel !== name;
    }
    // "Specials" toggle: free swapping any time, or only on the pick screens (before the first point and after every 5th point). Online the server owns it (net.setFixed) and only the
    // host may change it; the label follows the game state, so it catches up a moment after the click.
    function labelPick() {
        if (!pickBtn || typeof pickFixed === 'undefined')
            return;
        pickBtn.textContent = 'Specials: ' + (pickFixed ? 'Pick screens' : 'Free swap');
        pickBtn.classList.toggle('on', pickFixed);
        const locked = net.on && !net.host; // online, only the host can change this
        pickBtn.disabled = locked;
        pickBtn.title = locked ? 'Only the host (the player who created the room) can change this.' : pickTitle;
    }
    // The 2v2 button: offline it toggles 2v2 against the AI (input.js keeps its label); online it is the room's 2v2 lobby switch, host only. The server restarts the match, and the
    // label follows the roster message, so it catches up a moment after the click.
    const teamBtn = document.getElementById('mode2v2');
    function labelTeams() {
        if (!teamBtn || !net.on)
            return;
        teamBtn.textContent = '2v2 lobby: ' + (net.lobby2v2 ? 'On' : 'Off');
        teamBtn.classList.toggle('on', !!net.lobby2v2);
        teamBtn.disabled = !net.host;
        teamBtn.title = net.host ? 'On: new players fill Blue, Red, Blue 2 and Red 2 automatically, and the match starts once all four seats are taken (restarts the match). Off: new players wait for you to place them.' : 'Only the host (the player who created the room) can change this.';
    }
    // Special ability picker: big buttons, for touch screens where the keycaps on the wall are tiny, and for online seats that have no keycap (the second player on a team).
    // It changes the player you control (touch.seat()).
    function renderPicker() {
        if (!pickEl || typeof touch === 'undefined' || typeof SPECIALS === 'undefined')
            return;
        const seat = touch.seat(), p = seat >= 0 ? allPlayers[seat] : null;
        pickEl.textContent = '';
        if (pickFixed) {
            pickEl.textContent = 'Specials are chosen on the pick screens (before the first point and after every ' + PICK_EVERY + 'th point).';
            return;
        }
        if (!p) {
            pickEl.textContent = 'You are spectating: there is no player to change.';
            return;
        }
        const cur = (net.on && net.pendingSpecial) || p.special;
        for (const s of SPECIALS) {
            const b = document.createElement('button');
            b.className = 'mode' + (s.id === cur ? ' on' : '');
            b.textContent = s.name.charAt(0) + s.name.slice(1).toLowerCase();
            b.addEventListener('click', () => {
                if (net.on)
                    net.setSpecial(s.id);
                else
                    p.special = s.id;
                renderPicker();
            });
            pickEl.appendChild(b);
        }
    }
    // Players tab (online): Blue, Red and the waiting list. The host gets buttons to move people; a team holds two players at most, and the match waits while a team is empty.
    function memberRow(m) {
        const row = document.createElement('div');
        row.className = 'mem';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = 'Player ' + m.c;
        row.appendChild(name);
        for (const [flag, text] of [[m.c === net.you, 'YOU'], [m.host, 'HOST']])
            if (flag) {
                const t = document.createElement('span');
                t.className = 'tag';
                t.textContent = text;
                row.appendChild(t);
            }
        if (net.host)
            for (const [label, to, cls] of [['Blue', 0, 'blue'], ['Red', 1, 'red'], ['Wait', -1, '']]) {
                if (to === m.team)
                    continue;
                const b = document.createElement('button');
                b.textContent = label;
                if (cls)
                    b.className = cls;
                b.disabled = to >= 0 && net.members.filter(x => x.team === to).length >= 2; // that team is full
                b.addEventListener('click', () => net.assign(m.c, to));
                row.appendChild(b);
            }
        return row;
    }
    function renderRoster() {
        if (!rosterEl)
            return;
        rosterEl.textContent = '';
        if (!net.on) {
            const p = document.createElement('p');
            p.className = 'hint';
            p.textContent = 'Teams are arranged online: the player who creates the room is the host and can move everyone between Blue, Red and the waiting list. Offline, use the 2v2 button and the AI toggles.';
            rosterEl.appendChild(p);
            return;
        }
        for (const g of [{ team: 0, title: 'Blue', cls: 'blue' }, { team: 1, title: 'Red', cls: 'red' }, { team: -1, title: 'Waiting', cls: '' }]) {
            const list = net.members.filter(m => m.team === g.team), box = document.createElement('div'), h = document.createElement('h3');
            box.className = 'team';
            h.textContent = g.title + ' (' + list.length + (g.team >= 0 ? '/2' : '') + ')';
            if (g.cls)
                h.classList.add(g.cls);
            box.appendChild(h);
            if (!list.length) {
                const p = document.createElement('p');
                p.className = 'hint';
                p.textContent = g.team >= 0 ? (net.lobby2v2 ? 'Nobody yet: the 2v2 match waits until both teams are full.' : 'Nobody yet: the match waits until both teams have a player.') : 'Nobody waiting.';
                box.appendChild(p);
            }
            for (const m of list)
                box.appendChild(memberRow(m));
            rosterEl.appendChild(box);
        }
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = net.host ? 'You are the host. Moving a player restarts the match.' : 'Only the host can move players.';
        rosterEl.appendChild(note);
    }
    if (pickBtn)
        pickBtn.addEventListener('click', () => {
            if (net.on && !net.host)
                return;
            const want = !pickFixed;
            if (typeof closeSpecialMenu === 'function')
                closeSpecialMenu();
            if (net.on) { // the server restarts the match with the new setting and the next snapshots carry it back
                net.setFixed(want);
                setTimeout(() => { labelPick(); renderPicker(); }, 300);
            } else {
                setPickMode(want); // restarts the match
                labelPick();
                renderPicker();
            }
        });
    function refresh() { // the roster or the game state changed while the panel is up
        if (!isOpen())
            return;
        labelPick();
        labelTeams();
        renderPicker();
        renderRoster();
    }
    function open(tab) {
        if (typeof touch !== 'undefined')
            touch.releaseAll(); // a thumb still on the stick must not leave a key held while the panel is up
        if (tab)
            showTab(tab);
        document.body.classList.toggle('online', !!net.on); // shows the special picker online even without a touch screen
        labelPick();
        labelTeams();
        renderPicker();
        renderRoster();
        menu.hidden = false;
    }
    function close() {
        menu.hidden = true;
        if (canvas)
            canvas.focus(); // so keys go back to the game
    }
    document.getElementById('menuclose').addEventListener('click', close);
    menu.addEventListener('click', e => { if (e.target === menu) close(); }); // a click on the dark backdrop closes it
    for (const t of tabs)
        t.addEventListener('click', () => showTab(t.dataset.tab));
    // Esc toggles the panel. Capture phase, so this runs before input.js closes the special-ability list: if that list is open, Esc only closes it.
    window.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || e.repeat)
            return;
        if (isOpen())
            close();
        else if (typeof ui === 'undefined' || ui.open < 0)
            open();
    }, true);
    labelPick();
        // The Menu button's real, clickable element: an invisible <button> placed exactly over the pill that special-menu.js draws on the floor. A real button gets mouse, touch
    // and keyboard handling for free, and it does not depend on the canvas hit-test. It is repositioned whenever the canvas changes size.
    const btn = document.getElementById('menubtn');
    function placeBtn() {
        if (!btn || !canvas || typeof menuKey !== 'function')
            return;
        const r = canvas.getBoundingClientRect(), s = r.width / canvas.width, k = menuKey();
        btn.style.left = r.left + (OX + k.x) * s + 'px';
        btn.style.top = r.top + (HUD + k.y) * s + 'px';
        btn.style.width = k.w * s + 'px';
        btn.style.height = k.h * s + 'px';
    }
    if (btn) {
        btn.addEventListener('click', () => {
            btn.blur(); // so Space / Enter go back to being game keys
            if (isOpen())
                close();
            else
                open();
        });
        btn.addEventListener('mouseenter', () => { ui.hover = { type: 'menu' }; }); // keeps the drawn pill's hover highlight
        btn.addEventListener('mouseleave', () => { if (ui.hover && ui.hover.type === 'menu') ui.hover = null; });
        window.addEventListener('resize', placeBtn);
        window.addEventListener('orientationchange', placeBtn);
        if (typeof ResizeObserver !== 'undefined' && canvas)
            new ResizeObserver(placeBtn).observe(canvas);
        placeBtn();
        requestAnimationFrame(placeBtn);
    }
    return { open, close, refresh, isOpen };
})();
