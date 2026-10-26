// MOVES TAB - the menu's ability reference. Shows a page for each equipped special that has one (today: Fighter's full move list with its stats). Display only.
// To document another ability, add an entry to ABILITY_PAGES: { title, build(seat) -> element }. The tab appears only while one of your equipped specials has a page.
const movesUi = (() => {
    const root = document.getElementById('movesinfo'), tab = document.querySelector('[data-tab="moves"]'), menu = document.getElementById('menu');
    if (!root || !tab || !menu)
        return { refresh() {} };
    const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
    const ARROWS = { 1: '\u2199', 2: '\u2193', 3: '\u2198', 4: '\u2190', 5: '\u2022', 6: '\u2192', 7: '\u2196', 8: '\u2191', 9: '\u2197' };
    const motionText = m => m.split('|').map(s => [...s].map(c => ARROWS[c] || c).join(' ')).join('   or   ');
    const secs = t => (t * DT).toFixed(2) + ' s';
    const ticks = t => t + ' ticks (' + secs(t) + ')';
    const num = v => (Math.round(v * 100) / 100).toString();
    const knockText = kn => (kn.x ? num(kn.x) + ' forward' : '') + (kn.x && kn.y ? ', ' : '') + (kn.y ? num(Math.abs(kn.y)) + (kn.y < 0 ? ' up' : ' down') : '') + ' u/s';
    const deg = a => Math.round(a * 180 / Math.PI) + '\u00b0';

    function table(rows) {
        const body = el('tbody');
        for (const [k, v] of rows)
            body.append(el('tr', {}, el('td', { className: 'k', textContent: k }), el('td', { textContent: v })));
        return el('table', { className: 'stats' }, body);
    }

    // ---- Fighter ----
    function fighterStats(mv, keyOf) {
        const rows = [], add = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push([k, v]); };
        add('Input', (mv.motion ? motionText(mv.motion) + ' + ' : '') + (mv.button === 'sp' ? 'P' : 'K') + ' (' + keyOf(mv.button) + ')');
        if (mv.motion)
            add('Motion window', secs(Math.round((mv.motionT || FIGHTER_MOTION_T) / DT)) + ' to finish');
        add('Startup', ticks(mv.startup));
        add('Active', ticks(mv.active));
        add('Recovery', ticks(mv.recovery));
        add('Total', ticks(mv.startup + mv.active + mv.recovery));
        if (mv.vx !== undefined || mv.vy !== undefined)
            add('Own velocity', (mv.vx ? num(mv.vx) + ' ' + (mv.back ? 'backward' : 'forward') : '') + (mv.vx && mv.vy ? ', ' : '') + (mv.vy ? num(Math.abs(mv.vy)) + (mv.vy < 0 ? ' up' : ' down') : '') + ' u/s');
        if (mv.hit) {
            const h = mv.hit;
            add('Hitbox', (h.rx ? 'ellipse ' + h.rx + ' x ' + h.ry : 'circle r ' + h.r) + ', ' + num(h.x) + ' forward, ' + num(Math.abs(h.y)) + (h.y <= 0 ? ' up' : ' down') + ' of centre');
        }
        if (mv.sweep) {
            const s = mv.sweep;
            add('Hitbox', 'swing: radius ' + num(s.r) + ', hit radius ' + s.hitR + ', ' + deg(s.a0) + ' to ' + deg(s.a1) + (s.steer ? ', steered by the arrows' : ''));
            add('Knockback', 'flung along the swing at ' + s.speed + ' u/s' + (s.ballSpeed && s.ballSpeed !== s.speed ? ' (ball ' + s.ballSpeed + ')' : ''));
        }
        if (mv.knock) {
            add('Knockback (players)', mv.away ? 'away from the fighter: ' + knockText(mv.knock) : knockText(mv.knock));
            if (mv.ballKnock)
                add('Knockback (ball)', knockText(mv.ballKnock));
        }
        if (mv.fire) {
            const f = mv.fire;
            add('Projectile', 'speed ' + f.vx + ' u/s, radius ' + num(f.r) + ', lasts ' + f.life + ' s, spawns ' + f.x + ' forward');
            add('Knockback (players)', knockText(f.knock));
            add('Knockback (ball)', knockText(f.ballKnock || f.knock));
            if (f.stun)
                add('Stun', f.stun.t + ' s');
        }
        if (mv.burst) {
            const b = mv.burst;
            add('Burst', b.n + ' ' + b.type + ' shots at ' + b.speed + ' u/s in a ring');
            const T = PROJ_TYPES[b.type];
            if (T && T.knock)
                add('Knockback', num(T.knock) + ' u/s per hit');
            if (T && T.stun)
                add('Stun', T.stun + ' s');
        }
        if (mv.stun)
            add('Stun', mv.stun.t + ' s');
        if (mv.rehit)
            add('Multi-hit', 'can hit the same target again every ' + ticks(mv.rehit));
        if (mv.cancel)
            add('Cancel', 'can be cancelled into a special' + (FIGHTER_CANCEL_NEEDS_HIT ? ' once it connects' : ' once active'));
        if (mv.back)
            add('Direction', 'goes away from the net');
        if (mv.zone)
            add('Zone', mv.zone === 'home' ? 'only on your own half' : 'only on the enemy half');
        return rows;
    }
    const openMoves = new Set(); // ids of moves the player has expanded (kept across rebuilds)
    function buildFighter(seat) {
        const keyOf = a => keyName(keybinds.map[Math.max(0, seat)][a]), box = el('div');
        box.append(el('p', { className: 'hint', textContent: 'Fighter takes both special keys: ' + keyOf('sp') + ' is P (Phsyical) and ' + keyOf('sp2') + ' is S (Special). Motions are shown as if you face right; "forward" is always toward the net, so on the right half they are mirrored. Times are physics ticks (' + Math.round(1 / DT) + ' per second); speeds are in u/s, one player length is ' + PL + ' u.' }));
        for (const [btn, title] of [['sp', 'P moves'], ['sp2', 'S moves']]) {
            const list = FIGHTER_MOVES.filter(m => m.button === btn);
            if (!list.length)
                continue;
            box.append(el('h3', { textContent: title + ' (' + keyOf(btn) + ')' }));
            for (const mv of list) {
                const d = el('details', { className: 'move', open: openMoves.has(mv.id) },
                    el('summary', {},
                        el('span', { className: 'nm', textContent: mv.name || mv.id }),
                        el('span', { className: 'mot', textContent: mv.motion ? motionText(mv.motion) : 'plain press' }),
                        el('span', { className: 'tot', textContent: (mv.startup + mv.active + mv.recovery) + ' ticks' })),
                    table(fighterStats(mv, keyOf)));
                d.addEventListener('toggle', () => { if (d.open) openMoves.add(mv.id); else openMoves.delete(mv.id); });
                box.append(d);
            }
        }
        box.append(el('h3', { textContent: 'General rules' }), table([
            ['Motion leniency', 'neutral between steps is ignored; a diagonal may be skipped, a straight step may not'],
            ['Motion window', secs(Math.round(FIGHTER_MOTION_T / DT)) + ' to finish (some moves differ)'],
            ['Button lead', 'press the button within ' + secs(Math.round(FIGHTER_LEAD_T / DT)) + ' of finishing the motion'],
            ['Button buffer', 'a press during a move fires when it ends, within ' + secs(Math.round(FIGHTER_BTN_BUFFER_T / DT))],
            ['Momentum carry', Math.round(FIGHTER_CARRY * 100) + '% of your velocity is added to what you hit'],
            ['Stun', 'stunned players fall at ' + Math.round(FIGHTER_STUN_GRAV * 100) + '% gravity and lose speed; Awakened players ignore it'],
            ['Teammates', FIGHTER_HITS_TEAMMATES ? 'your moves hit teammates too' : 'your moves skip teammates'],
            ['Killing', 'nothing here kills: only the death ball does'],
        ]));
        return box;
    }

    const ABILITY_PAGES = { fighter: { title: 'Fighter', build: buildFighter } };

    let shown = null;
    function refresh() {
        const seat = touch.seat(), p = seat >= 0 ? allPlayers[seat] : null;
        const ids = p ? [...new Set(p.slots().map(s => s[1]))].filter(id => ABILITY_PAGES[id]) : [];
        tab.hidden = !ids.length;
        if (!ids.length) {
            if (tab.classList.contains('on'))
                menu.querySelector('[data-tab="game"]').click(); // the page vanished while it was open
            if (shown !== null) { root.textContent = ''; shown = null; }
            return;
        }
        const key = JSON.stringify([ids, seat, keybinds.map[Math.max(0, seat)]]);
        if (key === shown)
            return;
        shown = key;
        root.textContent = '';
        for (const id of ids) {
            if (ids.length > 1)
                root.append(el('h2', { textContent: ABILITY_PAGES[id].title }));
            root.append(ABILITY_PAGES[id].build(seat));
        }
    }
    tab.addEventListener('click', refresh);
    setInterval(refresh, 400); // cheap: it only rebuilds when your specials or keys change
    refresh();
    return { refresh };
})();