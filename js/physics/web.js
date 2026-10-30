// PHYSICS - web: the WEB special. Never draws (see render/web.js). Built on physics/statics.js; tuning numbers live in constants.js (WEB_*).
// Load order: after statics.js and player.js, before game/rules.js.
//
// HOW IT PLAYS: press the special key to drop a node where you stand. Every node is joined by a line to each OLDER node of yours, so n nodes make n(n-1)/2 lines. Anything whose
// centre crosses a line loses WEB_SLOW of its velocity, once per crossing. At WEB_MAX nodes the next press replaces your oldest. Nodes stay until the round ends (WEB_LIFE = 0).
//
// CROSSING: no extra state is kept. Where a body was a tick ago is rebuilt from its velocity (x - vx * DT), and a body crosses a line when that short move cuts it. That is exact for
// free flight and close enough around bounces; a teleport (warp, portal, swap) moves the body without a matching velocity, so it is never counted as a crossing.
// A line is handled by its NEWER end, so each line is checked once per body per tick. Stuck arrows are ignored (they do not move).
function placeWebNode(p) {
    return placeStatic('web', p, p.x, p.y);
}
function webCut(b) {
    const k = 1 - WEB_SLOW;
    b.vx *= k;
    b.vy *= k;
    if (b.sp !== undefined) // boomerangs steer from their own speed field, which would otherwise overwrite the cut next tick
        b.sp *= k;
}
STATIC_TYPES.web = {
    max: WEB_MAX, life: WEB_LIFE, fx: 0.3,
    step(s, bodies) { // s = one node; its lines run to every older node of the same owner
        for (const o of statics) {
            if (o.type !== 'web' || o.owner !== s.owner || o.id >= s.id)
                continue;
            for (const b of bodies) {
                if (!WEB_HITS_OWN_TEAM && b.team === s.team)
                    continue;
                if (segCross(b.x - b.vx * DT, b.y - b.vy * DT, b.x, b.y, o.x, o.y, s.x, s.y)) {
                    webCut(b);
                    s.flash = o.flash = 1; // the line lights up (display only)
                }
            }
        }
    },
};
