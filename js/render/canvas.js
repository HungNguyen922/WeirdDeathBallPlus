// RENDER - canvas handle and shared drawing constants.
const cv = document.getElementById('c');
const cx = cv.getContext('2d');
const line = (x1, y1, x2, y2) => { cx.moveTo(x1, y1); cx.lineTo(x2, y2); };
const clamp01 = v => Math.max(0, Math.min(1, v));
const OX = 176, CW = W + 2 * OX; // side margin drawn around the arena, full canvas width
const TERRAIN = '#2a1048', EDGE = '#9a63f0'; // platform fill and outline: dark purple to match the death ball
const HUD = 0, TINT = 0.16; // HUD = height of a strip above the arena (0 now: the score lives on the floor, see hud.js); strength of each side's color tint
// Size the canvas from the constants so it can never drift from the layout (index.html's width / height attributes are only a first guess).
cv.width = CW;
cv.height = HUD + H + PIT;
