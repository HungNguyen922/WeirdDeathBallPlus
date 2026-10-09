// MENU - the Menu panel with two tabs: Game (AI players, 2v2, music, online) and Controls (key bindings for every player).
// It is opened from the Menu tile on Blue's wall (drawn in render/special-menu.js, clicked in input.js) or with Esc, and closed with the X, a click on the backdrop, or Esc.
// Pure page UI: the buttons inside it are the same ones input.js, music.js and net/client.js already find by id (ai0..ai3, mode2v2, music, online), so nothing else changes.
// Load after the other scripts, before main.js.
const gameMenu = (() => {
    const menu = document.getElementById('menu'), canvas = document.getElementById('c');
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
    function open(tab) {
        if (tab)
            showTab(tab);
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
