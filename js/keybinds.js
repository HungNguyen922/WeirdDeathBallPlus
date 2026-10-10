// KEYBINDS - what key does what, for every seat, and where that is remembered.
// Each seat (player id 0..3 = Blue, Red, Blue 2, Red 2) has one key per action: l / r / up / dn (move, jump, drop), z (grapple), x (weight), sp (special).
// A key is stored as a short token: the lower-cased character for letters and digits ('x', '5'), the key name for the others ('ArrowLeft', 'Enter', 'Shift') and the physical code for the
// numpad ('Numpad4'), so the numpad and the top row never get mixed up.
// The bindings live in this browser (localStorage), like the music setting: nothing about them goes to the server, so it works the same on any host, including one with no storage.
// Load before input.js. input.js and net/client.js rebuild their key -> action tables whenever `keybinds.listeners` fire.
const KEY_ACTIONS = ['l', 'r', 'up', 'dn', 'z', 'x', 'sp'];
const KEY_ACTION_NAMES = { l: 'Left', r: 'Right', up: 'Jump', dn: 'Drop', z: 'Grapple', x: 'Weight', sp: 'Special' };
const KEY_DEFAULTS = [
    { l: 'ArrowLeft', r: 'ArrowRight', up: 'ArrowUp', dn: 'ArrowDown', z: 'x', x: 'c', sp: 'z' }, // Blue
    { l: 'a', r: 'd', up: 'w', dn: 's', z: 'f', x: 'g', sp: 'h' }, // Red
    { l: 'j', r: 'l', up: 'i', dn: 'k', z: 'u', x: 'o', sp: 'p' }, // Blue's teammate (2v2)
    { l: 'Numpad4', r: 'Numpad6', up: 'Numpad8', dn: 'Numpad5', z: 'Numpad7', x: 'Numpad9', sp: 'Numpad0' }, // Red's teammate (2v2)
];
const KEY_STORE = 'wdb-keybinds';
const KEY_RESERVED = { Escape: 'Esc closes menus', r: 'R restarts the match', t: 'T switches 1v1 / 2v2', m: 'M turns the music on / off', 1: '1-4 toggle the AI', 2: '1-4 toggle the AI', 3: '1-4 toggle the AI', 4: '1-4 toggle the AI' }; // keys the game itself uses
const KEY_REFUSED = ['Control', 'Alt', 'Meta', 'Tab', 'CapsLock', 'ContextMenu', 'Dead', 'Unidentified', 'Process']; // modifiers and keys the browser or OS keeps for itself

const keybinds = { map: KEY_DEFAULTS.map(s => ({ ...s })), listeners: [] }; // map[seat][action] = token

function keyToken(e) { // the token for a keyboard event
    if (e.code && e.code.startsWith('Numpad'))
        return e.code;
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}
function keyName(t) { // what the Controls table shows
    const arrows = { ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193' };
    if (arrows[t])
        return arrows[t];
    if (t === ' ')
        return 'Space';
    const num = /^Numpad(.+)$/.exec(t);
    if (num)
        return 'Num ' + ({ Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.' }[num[1]] || num[1]);
    return t.length === 1 ? t.toUpperCase() : t;
}
function keyLabel(t, arrowGlyph) { // the tiny corner label on the wall keycaps (empty for arrow keys on the arrow cluster, which already shows the arrow)
    if (arrowGlyph && /^Arrow/.test(t))
        return '';
    const short = { ' ': 'SPC', Enter: 'ENT', Shift: 'SFT', Backspace: 'BSP', Delete: 'DEL', Insert: 'INS', Home: 'HOM', End: 'END', PageUp: 'PGU', PageDown: 'PGD', NumpadEnter: 'N-E' }[t];
    if (short)
        return short;
    const num = /^Numpad(.+)$/.exec(t);
    if (num)
        return ({ Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.' }[num[1]] || num[1]);
    const arrows = { ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193' };
    if (arrows[t])
        return arrows[t];
    return t.length === 1 ? t.toUpperCase() : t.slice(0, 3).toUpperCase();
}
function keyLabels(seat, arrowGlyph) { // { l, r, up, dn, z, x, sp } -> corner labels for the wall hints
    const out = {};
    for (const a of KEY_ACTIONS)
        out[a] = keyLabel(keybinds.map[seat][a], arrowGlyph && ['l', 'r', 'up', 'dn'].includes(a));
    return out;
}
function keyCheck(e) { // can this key be bound? returns '' if yes, otherwise the reason
    const t = keyToken(e);
    if (KEY_REFUSED.includes(e.key))
        return 'That key cannot be used.';
    if (!(e.code && e.code.startsWith('Numpad')) && KEY_RESERVED[t])
        return KEY_RESERVED[t] + ', so it cannot be bound.';
    return '';
}
function keyOwner(token) { // [seat, action] currently using this token, or null
    for (let s = 0; s < 4; s++)
        for (const a of KEY_ACTIONS)
            if (keybinds.map[s][a] === token)
                return [s, a];
    return null;
}
function keyChanged() {
    for (const f of keybinds.listeners)
        f();
}
function bindKey(seat, action, token) { // give this action the key; if another action had it, that one gets this action's old key (a swap), so no key ever does two things
    const old = keybinds.map[seat][action];
    if (old === token)
        return;
    const owner = keyOwner(token);
    if (owner)
        keybinds.map[owner[0]][owner[1]] = old;
    keybinds.map[seat][action] = token;
    saveKeybinds();
    keyChanged();
}
function resetKeybinds() {
    keybinds.map = KEY_DEFAULTS.map(s => ({ ...s }));
    saveKeybinds();
    keyChanged();
}
function saveKeybinds() {
    try {
        const same = JSON.stringify(keybinds.map) === JSON.stringify(KEY_DEFAULTS);
        if (same)
            localStorage.removeItem(KEY_STORE); // nothing custom: forget it
        else
            localStorage.setItem(KEY_STORE, JSON.stringify(keybinds.map));
    } catch (e) {} // private mode / storage blocked: the bindings just last until the page is closed
}
(function loadKeybinds() {
    try {
        const raw = localStorage.getItem(KEY_STORE);
        if (!raw)
            return;
        const o = JSON.parse(raw), seen = new Set(), next = [];
        for (let s = 0; s < 4; s++) {
            const m = {};
            for (const a of KEY_ACTIONS) {
                const t = o && o[s] && o[s][a];
                if (typeof t !== 'string' || !t || t.length > 16 || seen.has(t) || KEY_REFUSED.includes(t) || (KEY_RESERVED[t] && !t.startsWith('Numpad')))
                    return; // anything odd (an old or hand-edited value, a clash): ignore the whole thing and keep the defaults
                seen.add(t);
                m[a] = t;
            }
            next.push(m);
        }
        keybinds.map = next;
    } catch (e) {}
})();
