// CHAT - a message log in the top left corner of the game, plus the Enter-key text box that feeds it.
// Online, what you type goes to everybody in the room through the server (net.sendChat -> server/server.js -> every member's net.onMessage -> chat.receive).
// Offline there is nobody to talk to, so the same box is a notepad: your own lines stay on screen.
// Press Enter to start typing (the game stops hearing the keyboard), Enter again to send, Esc to cancel. It can be switched off on the menu's Game tab (remembered in this browser).
// Load after net/client.js (it uses `net`) and before menu.js: the capture-phase key listener below has to run before menu.js's Esc listener.
const chat = (() => {
    const MAX_LEN = 120; // must match CHAT_MAX in server/server.js
    const KEEP = 60; // lines remembered
    const SHOW = 8; // lines drawn at once
    const FADE_AFTER_MS = 12000; // online, a line fades out after this long (everything comes back while you type). Offline notes never fade. Set to 0 to never fade.
    const STORE = 'wdb-chat';
    const root = document.getElementById('chat'), logEl = document.getElementById('chatlog'), input = document.getElementById('chatinput'), canvas = document.getElementById('c');
    if (!root || !logEl || !input)
        return { receive() {}, isTyping: () => false, setEnabled() {}, isEnabled: () => false };

    let enabled = true, typing = false;
    try { enabled = localStorage.getItem(STORE) !== '0'; } catch (e) {}
    const lines = []; // { name, color, text, at, sys }

    // ---- placement: pinned to the canvas's top left corner, and scaled with the canvas ----
    function place() {
        if (!canvas)
            return;
        const r = canvas.getBoundingClientRect(), s = Math.max(0.6, Math.min(1.4, r.width / 1302));
        root.style.left = r.left + 10 * s + 'px';
        root.style.top = r.top + 10 * s + 'px';
        root.style.width = Math.min(460 * s, r.width * 0.42) + 'px';
        root.style.fontSize = 13 * s + 'px';
    }
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    if (typeof ResizeObserver !== 'undefined' && canvas)
        new ResizeObserver(place).observe(canvas);

    // ---- drawing the log (DOM text only: textContent, so nothing a player sends can inject markup) ----
    const online = () => typeof net !== 'undefined' && net.on;
    function render() {
        logEl.textContent = '';
        const now = performance.now(), fade = online() ? FADE_AFTER_MS : 0;
        let anyVisible = false;
        for (const l of lines.slice(-SHOW)) {
            const age = now - l.at, hidden = !typing && fade > 0 && age > fade + 1500;
            if (hidden)
                continue;
            anyVisible = true;
            const row = document.createElement('div');
            row.className = 'cline' + (l.sys ? ' sys' : '');
            if (!typing && fade > 0 && age > fade)
                row.style.opacity = String(Math.max(0, 1 - (age - fade) / 1500));
            if (l.name) {
                const n = document.createElement('b');
                n.textContent = l.name + ': ';
                n.style.color = l.color;
                row.appendChild(n);
            }
            row.appendChild(document.createTextNode(l.text));
            logEl.appendChild(row);
        }
        root.hidden = !enabled || (!anyVisible && !typing);
        logEl.hidden = !anyVisible;
    }
    let timer = 0;
    function tick() { // keep fading lines up to date while any are still showing
        render();
        clearTimeout(timer);
        if (enabled && !typing && online() && lines.length && performance.now() - lines[lines.length - 1].at < FADE_AFTER_MS + 1600)
            timer = setTimeout(tick, 250);
    }
    function add(l) {
        lines.push({ ...l, at: performance.now() });
        if (lines.length > KEEP)
            lines.shift();
        tick();
    }
    const teamName = t => (t === 0 ? '#42a5f5' : t === 1 ? '#ef5350' : '#98a2ad');
    function receive(m) { // a {t:'chat'} message from the server
        if (typeof m.text !== 'string')
            return;
        const text = m.text.slice(0, MAX_LEN * 2);
        if (m.sys)
            return add({ text, sys: true });
        add({ name: 'Player ' + m.c + (typeof net !== 'undefined' && m.c === net.you ? ' (you)' : ''), color: teamName(m.team), text });
    }

    // ---- typing ----
    function releaseKeys() { // keys held when Enter is pressed must not stay stuck down while the keyboard belongs to the text box
        if (typeof allPlayers !== 'undefined' && typeof noKeys === 'function')
            allPlayers.forEach(p => Object.assign(p.keys, noKeys()));
        if (online() && Object.values(net.keys).some(Boolean)) {
            Object.assign(net.keys, noKeys());
            net.sendKeys();
        }
        if (typeof touch !== 'undefined')
            touch.releaseAll();
    }
    function openBox() {
        typing = true;
        releaseKeys();
        place();
        input.hidden = false;
        input.value = '';
        render();
        input.focus();
    }
    function closeBox() {
        if (!typing)
            return;
        typing = false;
        input.hidden = true;
        input.value = '';
        if (canvas)
            canvas.focus(); // so keys go back to the game
        tick();
    }
    function send() {
        const text = input.value.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
        closeBox();
        if (!text)
            return;
        if (online()) {
            if (!net.sendChat(text))
                add({ text: 'Not connected: your message was not sent.', sys: true });
        } else
            add({ name: 'Note', color: '#c9b8f0', text }); // offline: nobody to send it to, so it stays as a note
    }
    // Capture phase on window: while the box is open nothing else (the game, the music key, the menu's Esc) may see a key press, but the text box still gets its typing,
    // because we only stop the event travelling, never cancel its default action.
    window.addEventListener('keydown', e => {
        if (typing) {
            if (e.isComposing || e.keyCode === 229) { // an input method is mid-word: Enter belongs to it
                e.stopPropagation();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!e.repeat)
                    send();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                closeBox();
            } else
                e.stopPropagation();
            return;
        }
        const menu = document.getElementById('menu');
        if (e.key === 'Enter' && !e.repeat && enabled && !(menu && !menu.hidden) && typeof keyToken === 'function' && keyToken(e) === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const t = e.target;
            if (t && t !== document.body && t !== canvas && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
                return; // some other form field has the keyboard
            e.preventDefault();
            e.stopImmediatePropagation();
            if (typeof closeSpecialMenu === 'function')
                closeSpecialMenu();
            openBox();
        }
    }, true);
    window.addEventListener('keyup', e => { if (typing) e.stopPropagation(); }, true);
    input.addEventListener('blur', () => closeBox()); // clicking anywhere else drops the unsent text
    input.addEventListener('keypress', e => e.stopPropagation());

    function setEnabled(v) {
        enabled = !!v;
        if (!enabled)
            closeBox();
        try { localStorage.setItem(STORE, enabled ? '1' : '0'); } catch (e) {}
        const btn = document.getElementById('chatmode');
        if (btn) {
            btn.textContent = 'Chat: ' + (enabled ? 'On' : 'Off');
            btn.classList.toggle('on', enabled);
        }
        tick();
    }
    const btn = document.getElementById('chatmode');
    if (btn)
        btn.addEventListener('click', () => { setEnabled(!enabled); if (canvas) canvas.focus(); });
    setEnabled(enabled); // (also paints the button label from the remembered setting)
    place();
    return { receive, isTyping: () => typing, setEnabled, isEnabled: () => enabled, add };
})();
