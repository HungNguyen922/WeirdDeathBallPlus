// INPUT - keyboard bindings, the AI toggle buttons / keys, and mouse clicks on the special-ability menu.
const AI_NAMES = ['Blue', 'Red', 'Blue 2', 'Red 2'];
function setAI(i, on) {
    ai[i].on = on;
    aiReset(i);
    if (!on)
        Object.assign(allPlayers[i].keys, noKeys());
    const btn = document.getElementById('ai' + i);
    btn.textContent = AI_NAMES[i] + ': ' + (on ? 'AI' : 'Human');
    btn.classList.toggle('on', on);
}
for (const i of [0, 1, 2, 3])
    document.getElementById('ai' + i).addEventListener('click', () => { setAI(i, !ai[i].on); cv.focus(); });
// ---- 1v1 / 2v2 toggle: the teammates (ids 2 and 3) start as computer players; switch them to Human to play them ----
function setTeams(size) {
    setTeamSize(size);
    setAI(2, size === 2);
    setAI(3, size === 2);
    for (const el of document.querySelectorAll('.team2'))
        el.style.display = size === 2 ? '' : 'none';
    const btn = document.getElementById('mode2v2');
    btn.textContent = '2v2: ' + (size === 2 ? 'On' : 'Off');
    btn.classList.toggle('on', size === 2);
}
document.getElementById('mode2v2').addEventListener('click', () => { setTeams(teamSize === 2 ? 1 : 2); cv.focus(); });
// ---- input ----
const bindings = [ // [player, { key (or physical key code) -> action }]
    [p1, { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'up', ArrowDown: 'dn', x: 'z', c: 'x', z: 'sp' }],
    [p2, { a: 'l', d: 'r', w: 'up', s: 'dn', f: 'z', g: 'x', h: 'sp' }],
    [p3, { j: 'l', l: 'r', i: 'up', k: 'dn', u: 'z', o: 'x', p: 'sp' }], // Blue's teammate (2v2)
    [p4, { Numpad4: 'l', Numpad6: 'r', Numpad8: 'up', Numpad5: 'dn', Numpad7: 'z', Numpad9: 'x', Numpad0: 'sp' }], // Red's teammate (2v2)
];
function setKey(e, v) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    for (const [pl, m] of bindings) {
        const n = players.includes(pl) && (m[key] || m[e.code]); // only players in the current match listen
        if (n) {
            pl.keys[n] = v;
            e.preventDefault();
        }
    }
    if (v && key === 'Escape')
        closeSpecialMenu();
    const digit = /^Digit([1-4])$/.exec(e.code); // top-row 1-4 toggle each player's AI (3 and 4 only exist in 2v2)
    if (v && !e.repeat && digit && +digit[1] <= players.length)
        setAI(+digit[1] - 1, !ai[+digit[1] - 1].on);
    if (v && !e.repeat && key === 't')
        setTeams(teamSize === 2 ? 1 : 2);
    if (v && key === 'r')
        resetMatch();
}
window.addEventListener('keydown', e => setKey(e, true));
window.addEventListener('keyup', e => setKey(e, false));
window.addEventListener('blur', () => allPlayers.forEach(p => Object.assign(p.keys, noKeys())));
// ---- mouse: special-ability menu ----
const arenaPos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width - OX, (e.clientY - r.top) * cv.height / r.height - HUD]; };
cv.addEventListener('mousemove', e => { ui.hover = uiHit(...arenaPos(e)); cv.style.cursor = ui.hover ? 'pointer' : ''; });
cv.addEventListener('mouseleave', () => { ui.hover = null; cv.style.cursor = ''; });
cv.addEventListener('click', e => {
    const h = uiHit(...arenaPos(e));
    if (!h)
        closeSpecialMenu();
    else if (h.type === 'key')
        ui.open = ui.open === h.i ? -1 : h.i;
    else if (!SPECIALS[h.n].locked) {
        players[h.i].special = SPECIALS[h.n].id;
        closeSpecialMenu();
    }
});
cv.addEventListener('click', () => cv.focus()); // so keys go to the game after a click
