// RENDER - canvas handle and shared drawing constants.
const cv = document.getElementById('c');
const cx = cv.getContext('2d');
const line = (x1, y1, x2, y2) => { cx.moveTo(x1, y1); cx.lineTo(x2, y2); };
const clamp01 = v => Math.max(0, Math.min(1, v));
const OX = 176, CW = W + 2 * OX; // side margin drawn around the arena, full canvas width
const TERRAIN = '#2a1048', EDGE = '#9a63f0'; // platform fill and outline: dark purple to match the death ball
const HUD = 80, TINT = 0.16; // HUD strip height; strength of each side's color tint
