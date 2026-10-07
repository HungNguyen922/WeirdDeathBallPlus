// PHYSICS - terrain: the arena's static geometry (floor slopes, goal juts, out-of-bounds tunnels, hatchet pads)
// and the seesaw floor that pops up when something slams into it. Segments are [x1, y1, x2, y2].
// Floor slopes: a ramp up to each goal (SEGS[0..1]) and a middle peak made of two overlapping triangles (a notch the ball starts in).
const PEAK = [[NETX - PK - RUN, H], [NETX - PK, H - RISE], [NETX, H - RISE + NOTCH], [NETX + PK, H - RISE], [NETX + PK + RUN, H]];
const SEGS = [[0, GOAL_Y1, RUN, H], [W, GOAL_Y1, W - RUN, H]];
for (let i = 0; i < PEAK.length - 1; i++)
    SEGS.push([...PEAK[i], ...PEAK[i + 1]]);
// The wall above each goal juts out one player-width from the ceiling down to the goal opening, so each goal sits in a little alcove. It is part of
// the wall, so it never moves with the floor. Two faces per jut: the underside (over the goal) and the inner side.
const LEDGE_T = 3, LEDGES = [[0, GOAL_Y0, PL, GOAL_Y0], [PL, 0, PL, GOAL_Y0], [W, GOAL_Y0, W - PL, GOAL_Y0], [W - PL, 0, W - PL, GOAL_Y0]];
// ---- Out-of-bounds tunnels. Past each goal opening the ball enters a tunnel (the jut's underside carries on as its ceiling). The floor starts at the goal lip
// and slopes DOWN toward the threshold line, so any ball that falls out there is guided to it. The ball scores only when it crosses the threshold, OUT_D (5 player
// lengths) outside the goal. The HATCHET is a bounce pad on that slope, just outside the goal, facing up and out toward the threshold. ----
const OUT_D = 5 * PL, OUT_DROP = 56; // threshold distance; how far the tunnel floor drops over that distance (steeper = the ball gets there faster); the hatchet's steep section adds a bit more
const PAD_LEN = 48, PAD_ANG = Math.PI / 4, PAD_LIFT = 6, PAD_D0 = 14; // hatchet: plate length, tilt from horizontal (45 degrees), drawn thickness, distance of its inner end from the goal
const PAD_D1 = PAD_D0 + PAD_LEN * Math.cos(PAD_ANG); // distance of its outer end
const PAD_E = 5, PAD_KICK = 900, PAD_MAX = 1800, PAD_BOOST_T = 1.2; // bounce gain, minimum / maximum launch speed; the ball may exceed its normal speed cap right after a hatchet hit, easing back over PAD_BOOST_T seconds // bounce gain (>1 = adds energy), minimum launch speed, cap, and the softest hit that still triggers it (u/s)
const PIT = 64; // depth of the pit under the tunnels (the ball is removed if it falls this far below the floor)
const FK = OUT_DROP / OUT_D; // gentle base slope of the tunnel floor
// Tunnel floor d units outside the goal: gentle slope from the lip, then the hatchet's 45-degree section, then the gentle slope again. It only ever descends outward,
// so nothing can get stuck in a pocket.
const slopeY = d => GOAL_Y1 + FK * Math.min(d, PAD_D0) + Math.tan(PAD_ANG) * Math.max(0, Math.min(d, PAD_D1) - PAD_D0) + FK * Math.max(0, d - PAD_D1);
const outX = (side, d) => (side === 0 ? -d : W + d);
const OUTSEGS = [], PADS = [], OUTCEIL = [];
const padA = side => ({ x: outX(side, PAD_D0), y: slopeY(PAD_D0) }); // top (inner) end of the hatchet
const padB = side => ({ x: outX(side, PAD_D1), y: slopeY(PAD_D1) }); // bottom (outer) end
for (const side of [0, 1]) {
    const A = padA(side), B = padB(side);
    OUTSEGS.push([outX(side, 0), slopeY(0), A.x, A.y], [B.x, B.y, outX(side, OUT_D), slopeY(OUT_D)]);
    PADS.push([A.x, A.y, B.x, B.y]);
    OUTCEIL.push([outX(side, 0), GOAL_Y0, outX(side, OUT_D), GOAL_Y0]);
}
// Seesaw floor ("swing saw"): the floor is pivoted at the net line. It is static almost all the time, but a hard landing on a side's far half (the half
// by the goal) can pop the opposite far half up a little, kicking whatever is standing there. Nothing happens near the net.
// One signed tilt carries every hit's momentum, so hits from the two sides cancel: a slam on the side that is popping pushes it back down.
const SAW_HALF = NETX / 2; // half of a side's floor: only the half by the goal takes part
const SAW_MIN = 480; // impact momentum (mass x speed into the floor, u/s) a hit needs to move the seesaw: only real slams (a weighted drop after a grapple jump), not jumps or dribbling
const SAW_GAIN = 1.2, SAW_VMAX = 240; // tilt speed (u/s) = (momentum - SAW_MIN) * SAW_GAIN, capped; this is also the kick given to things resting on the rising end
const SAW_K = 100, SAW_C = 20; // floor spring (critically damped): it pops up fast and settles back down without bouncing
const padFlash = [0, 0]; // per-side hatchet "just hit" glow: set to 1 by padBounce, decayed by the renderer (kept here so the AI can snapshot/restore it)
const saw = { t: 0, v: 0 }; // seesaw tilt: t > 0 = the right far half is raised by t (u), t < 0 = the left one is; v = its speed
const sawQ = side => Math.max(0, side === 1 ? saw.t : -saw.t); // pop height of a side's far half
const sawQV = side => (sawQ(side) > 0 ? (side === 1 ? saw.v : -saw.v) : 0); // its speed (nothing moves on the end that rests on the ground)
// How much of a side's pop applies at x: 0 on the half by the net, rising smoothly to full over the quarter by the goal.
function sawW(x, side) {
    const d = side === 0 ? x : W - x, t = Math.max(0, Math.min(1, (SAW_HALF - d) / (SAW_HALF / 2)));
    return t * t * (3 - 2 * t);
}
const sawY = x => -(sawQ(0) * sawW(x, 0) + sawQ(1) * sawW(x, 1)); // floor offset at x (negative = raised)
const sawV = x => -(sawQV(0) * sawW(x, 0) + sawQV(1) * sawW(x, 1)); // floor speed at x (negative = rising)
function sawStep() {
    saw.v += (-SAW_K * saw.t - SAW_C * saw.v) * DT;
    saw.t += saw.v * DT;
}
// Something struck the floor at x with this much momentum: a hard enough hit tips the seesaw (left hit raises the right end, and vice versa).
// A hit on the end that is already popping pushes it back down, so equal slams from both sides cancel.
function sawHit(x, momentum) {
    const side = x < NETX ? 0 : 1, kick = Math.min(SAW_VMAX, (momentum - SAW_MIN) * SAW_GAIN) * sawW(x, side);
    if (kick > 0)
        saw.v = Math.max(-SAW_VMAX, Math.min(SAW_VMAX, saw.v + (side === 0 ? kick : -kick)));
}
function sawReset() {
    saw.t = 0;
    saw.v = 0;
}
