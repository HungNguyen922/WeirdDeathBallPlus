// SKIN DATA - what a skin IS, and the one function that decides whether a skin is allowed. Shared: the browser loads it as a plain script, the server loads it with require().
// No drawing and no DOM in here (see render/skin.js for drawing).
//
// A skin is a list of up to SKIN_MAX_LAYERS layers, drawn bottom to top. Each layer:
//    t  the shape            one of SKIN_SHAPES
//    x, y  where its centre is, in player radii from the player's centre (0, 0 = the middle; the edge of the circle is at distance 1)
//    w, h  half width / half height of the shape, in player radii (a circle with w = h = 1 would fill the whole player)
//    r  rotation in degrees
//    c  colour, '#rrggbb'
//    o  0 = INSIDE layer: clipped to the circle (a skin: stripes, faces, patterns)   1 = OUTSIDE layer: not clipped (hats, horns, mustaches, monocles)
// The team colour rim is always drawn on top of the inside layers, so a skin can never hide which team you are on.
'use strict';

const SKIN_SHAPES = ['oval', 'rect', 'tri', 'half', 'star', 'heart', 'ring', 'moon', 'cross'];
const SKIN_MAX_LAYERS = 24;
const SKIN_POS = 1.6;                // x and y are clamped to +-this (player radii)
const SKIN_SIZE_MIN = 0.05, SKIN_SIZE_MAX = 1.2; // w and h are clamped to this range
const SKIN_EXTENT = 3.5;             // nothing a valid skin draws reaches further than this from the centre (SKIN_POS + SKIN_SIZE_MAX x sqrt 2 = 3.3): the sprite canvas is this big

const skinNum = (v, lo, hi, fallback) => (typeof v === 'number' && isFinite(v)) ? Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100 : fallback;

// Anything in, a clean skin out: an array of valid layers (possibly empty). Never throws. Unknown shapes and bad colours drop that layer, numbers are clamped and rounded,
// extra layers beyond SKIN_MAX_LAYERS are ignored, and unknown keys are discarded. The server runs EVERY skin through this before storing or sending it.
function skinClean(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const l of raw) {
        if (out.length >= SKIN_MAX_LAYERS)
            break;
        if (!l || typeof l !== 'object' || !SKIN_SHAPES.includes(l.t) || typeof l.c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(l.c))
            continue;
        out.push({
            t: l.t,
            x: skinNum(l.x, -SKIN_POS, SKIN_POS, 0), y: skinNum(l.y, -SKIN_POS, SKIN_POS, 0),
            w: skinNum(l.w, SKIN_SIZE_MIN, SKIN_SIZE_MAX, 0.4), h: skinNum(l.h, SKIN_SIZE_MIN, SKIN_SIZE_MAX, 0.4),
            r: Math.round(skinNum(l.r, -180, 180, 0)),
            c: l.c.toLowerCase(),
            o: l.o ? 1 : 0
        });
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports)
    module.exports = { SKIN_SHAPES, SKIN_MAX_LAYERS, SKIN_POS, SKIN_SIZE_MIN, SKIN_SIZE_MAX, SKIN_EXTENT, skinClean };
