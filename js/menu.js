// MENU - the Menu panel with two tabs: Game (AI players, 2v2, special ability on touch screens, music, online) and Controls (key bindings for every player, plus touch controls on a phone).
// It is opened from the Menu tile on Blue's wall (drawn in render/special-menu.js, clicked in input.js) or with Esc, and closed with the X, a click on the backdrop, or Esc.
// Pure page UI: the buttons inside it are the same ones input.js, music.js and net/client.js already find by id (ai0..ai3, mode2v2, music, online), so nothing else changes.
// Load after the other scripts (touch.js too), before main.js.
const gameMenu = (() => {
    const menu = document.getElementById('menu'), canvas = document.getElementById('c'), pick = document.getElementById('specialpick');
    if (!menu)
        return { open() {}, close() {}, isOpen: () => false };
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
    // Special ability picker: big buttons, for touch screens where the keycaps on the wall are tiny. It changes the player the touch controls drive (touch.seat()).
    function renderPicker() {
        if (!pick || typeof touch === 'undefined' || typeof SPECIALS === 'undefined')
            return;
        const seat = touch.seat(), p = seat >= 0 ? allPlayers[seat] : null;
        pick.textContent = '';
        if (!p) {
            pick.textContent = 'You are spectating: there is no player to change.';
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
            pick.appendChild(b);
        }
    }
    function open(tab) {
        if (typeof touch !== 'undefined')
            touch.releaseAll(); // a thumb still on the stick must not leave a key held while the panel is up
        if (tab)
            showTab(tab);
        renderPicker();
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
    return { open, close, isOpen };
})();
