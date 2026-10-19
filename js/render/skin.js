// RENDER - skins: drawing a skin (see js/skin-data.js for what one is), working out which skin a player wears, and the cached sprites the game draws every frame. Display only.
// Load after js/skin-data.js and render/canvas.js, before render/players.js.
//
// A sprite is built once per (skin, team colour) and drawn with a single drawImage per player per frame:
//    inner   the inside layers clipped to the circle, then the team-colour rim on top (so a skin can never hide which team you are on). Drawn BEFORE the white outline.
//    outer   the outside layers (hats, horns, mustaches...). Drawn AFTER the outline, so nothing is crossed out by it. null when the skin has none.
const SKIN_PX = 40;          // pixels per player radius in a cached sprite (higher = sharper when zoomed in, bigger canvases)
const SKIN_RIM = 0.2;        // thickness of the team-colour rim, in player radii
const SKIN_STORE = 'wdb-skin'; // where this browser remembers your skin (a guest's only copy; for a signed-in player it is a backup)

// One shape, as a path in a unit box (about -1..1 each way) on the current transform. ring is the only one that needs the evenodd fill rule.
const SKIN_PATH = {
    oval: c => c.arc(0, 0, 1, 0, Math.PI * 2),
    rect: c => c.rect(-1, -1, 2, 2),
    tri: c => { c.moveTo(0, -1); c.lineTo(1, 1); c.lineTo(-1, 1); c.closePath(); },
    half: c => { c.moveTo(-1, 0.5); c.arc(0, 0.5, 1, Math.PI, 2 * Math.PI); c.closePath(); }, // a dome, flat side down, spanning y -0.5..0.5
    star: c => { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? 0.45 : 1; c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * k, Math.sin(a) * k); } c.closePath(); },
    heart: c => { c.moveTo(0, 0.85); c.bezierCurveTo(-1.3, 0, -0.9, -1, 0, -0.4); c.bezierCurveTo(0.9, -1, 1.3, 0, 0, 0.85); c.closePath(); },
    ring: c => { c.arc(0, 0, 1, 0, Math.PI * 2); c.moveTo(0.72, 0); c.arc(0, 0, 0.72, 0, Math.PI * 2, true); },
    moon: c => { // a crescent open to the right: the outer circle's long way round, then back along the bite
        const d = 0.45, r2 = 0.8, px = (d * d + 1 - r2 * r2) / (2 * d), py = Math.sqrt(1 - px * px);
        c.moveTo(px, -py); c.arc(0, 0, 1, Math.atan2(-py, px), Math.atan2(py, px), true);
        c.arc(d, 0, r2, Math.atan2(py, px - d), Math.atan2(-py, px - d), false); c.closePath();
    },
    cross: c => { c.rect(-1, -0.33, 2, 0.66); c.rect(-0.33, -1, 0.66, 2); }
};

// Build one layer's path on context c (already translated to the player's centre; U = pixels per radius). Leaves the layer's transform set: the caller saves / restores.
function skinLayerPath(c, l, U) {
    c.translate(l.x * U, l.y * U);
    c.rotate(l.r * Math.PI / 180);
    c.scale(l.w * U, l.h * U);
    c.beginPath();
    SKIN_PATH[l.t](c);
}
function skinPaintLayer(c, l, U) {
    c.save();
    skinLayerPath(c, l, U);
    c.fillStyle = l.c;
    c.fill(l.t === 'ring' ? 'evenodd' : 'nonzero');
    c.restore();
}
// Paint a skin onto c, which must already be translated so (0, 0) is the player's centre. part: 'inner' = inside layers + rim, 'outer' = outside layers.
function skinPaint(c, skin, U, color, part) {
    if (part === 'inner') {
        c.save();
        c.beginPath(); c.arc(0, 0, U, 0, Math.PI * 2); c.clip();
        for (const l of skin)
            if (!l.o)
                skinPaintLayer(c, l, U);
        c.restore();
        c.strokeStyle = color; c.lineWidth = SKIN_RIM * U;
        c.beginPath(); c.arc(0, 0, U * (1 - SKIN_RIM / 2), 0, Math.PI * 2); c.stroke();
    } else
        for (const l of skin)
            if (l.o)
                skinPaintLayer(c, l, U);
}

// ---- the cached sprites ----
const skinCache = new WeakMap(); // skin array -> { colour -> sprite }. A new array (a new roster, an edit) simply gets new sprites; the old ones are collected with it.
function skinCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
}
function skinBuild(skin, color) {
    const U = SKIN_PX, n = Math.ceil(2 * SKIN_EXTENT * U), m = Math.ceil(2 * U);
    const inner = skinCanvas(m, m), ci = inner.getContext('2d');
    ci.translate(m / 2, m / 2);
    skinPaint(ci, skin, U, color, 'inner');
    let outer = null;
    if (skin.some(l => l.o)) {
        outer = skinCanvas(n, n);
        const co = outer.getContext('2d');
        co.translate(n / 2, n / 2);
        skinPaint(co, skin, U, color, 'outer');
    }
    return { inner, outer };
}
function skinSprite(skin, color) { // the sprites for this skin in this team colour, or null for a plain player
    if (!skin || !skin.length)
        return null;
    let by = skinCache.get(skin);
    if (!by)
        skinCache.set(skin, by = {});
    return by[color] || (by[color] = skinBuild(skin, color));
}

// ---- which skin does this player wear? ----
function skinLocal() { // this browser's saved skin (a guest's, or the signed-in player's backup)
    try { return skinClean(JSON.parse(localStorage.getItem(SKIN_STORE))); } catch (e) { return []; }
}
let skinMine = null; // this browser's skin, cleaned once (the sprite cache keys on the array, so it must stay the same array until the skin really changes)
function skinMy() { // MY skin: the account's when signed in and one is saved there, otherwise this browser's
    if (typeof account !== 'undefined' && account.profile && Array.isArray(account.profile.skin) && account.profile.skin.length)
        return account.profile.skin;
    return skinMine || (skinMine = skinLocal());
}
function skinSaveLocal(skin) { // remember it in this browser and use it from the next frame on
    skinMine = skin;
    try { localStorage.setItem(SKIN_STORE, JSON.stringify(skin)); } catch (e) {}
}
function skinOf(p) { // online: my own seat shows my skin at once, everyone else's comes with the roster (only signed-in players have one). Offline: the first player is me.
    if (typeof net !== 'undefined' && net.on) {
        if (p.id === net.slot)
            return skinMy();
        const m = net.members.find(x => x.slot === p.id);
        return m && Array.isArray(m.skin) ? m.skin : null;
    }
    return p.id === 0 ? skinMy() : null;
}
