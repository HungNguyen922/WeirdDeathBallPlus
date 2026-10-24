// PHYSICS - split: the SPLIT special. Never draws (see render/split.js).
// Your active body is the Player itself (p.s = its share of full size, p.r its radius). The other bodies are p.clones: [{ x, y, vx, vy, s, r }], plain data, so they save / load / interpolate like everything else.
// The sizes of all your bodies always add up to 1. Load after mines.js, before game/rules.js (which calls stepSplit() and splitSurvive()).
const splitR = s => SPLIT_BASE_R * Math.sqrt(s); // s = share of full AREA
const playerReach = p => RANGE * Math.pow(p.s === undefined ? 1 : p.s, SPLIT_RANGE_POW); // a player's grapple range, shrunk by splitting

function adoptBody(p, c) { // the player's active body becomes c
    p.x = c.x; p.y = c.y; p.vx = c.vx; p.vy = c.vy; p.s = c.s; p.r = c.r;
    p.rope = null; p.pending = null; p.onBall = false; p.tball = null; p.driveT = 0; p.kickReq = false; p.stretchT = 0;
    p.netSide = p.x < NETX ? 0 : 1;
}
function splitMake(p) {
    if (p.cd.split > 0 || p.clones.length >= SPLIT_MAX - 1 || p.s * SPLIT_FACTOR < SPLIT_MIN_S - 1e-9)
        return false;
    const old = p.r, s = p.s * SPLIT_FACTOR, r = splitR(s), k = p.keys;
    let ux = (k.r ? 1 : 0) - (k.l ? 1 : 0), uy = (k.dn ? 1 : 0) - (k.up ? 1 : 0); // the direction you hold
    if (!ux && !uy)
        ux = p.x < NETX ? 1 : -1; // nothing held: toward the net
    const m = Math.hypot(ux, uy);
    ux /= m; uy /= m;
    p.s = s; p.r = r;
    if (p.ground)
        p.y += old - r; // keep your feet where they were
    // the copy is left behind, on the opposite side and thrown backwards; you (the active body) go the way you aimed
    p.clones.push({ x: p.x - ux * r, y: p.y - uy * r, vx: p.vx - ux * SPLIT_KICK, vy: p.vy - uy * SPLIT_KICK - SPLIT_HOP, s, r, lock: SPLIT_LOCK });
    p.x += ux * r;
    p.y += uy * r;
    p.vx += ux * SPLIT_KICK;
    p.vy += uy * SPLIT_KICK;
    p.splitLock = SPLIT_LOCK;
    p.cd.split = SPLIT_COOLDOWN;
    return true;
}
function splitSwitch(p) { // weight + special: take control of the next copy; your old body becomes a copy
    if (!p.clones.length)
        return false;
    const c = p.clones.shift();
    p.clones.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, s: p.s, r: p.r, lock: SPLIT_SWITCH_LOCK });
    adoptBody(p, c);
    p.splitLock = SPLIT_SWITCH_LOCK;
    return true;
}
function splitSurvive(p) { // p's active body just died: carry on as a copy if there is one
    if (!p.clones.length)
        return false;
    p.alive = true;
    adoptBody(p, p.clones.shift());
    p.splitLock = SPLIT_SWITCH_LOCK;
    return true;
}
function splitCollapse(p) { // swapped to another special (or the round reset): back to one full-size body
    if (p.ground)
        p.y -= SPLIT_BASE_R - p.r;
    p.s = 1; p.r = SPLIT_BASE_R; p.clones = [];
}
mixin(Player, {
    splitPress() { return this.sim ? false : this.keys.x ? splitSwitch(this) : splitMake(this); } // (the AI's planning copies never split)
});

function stepClone(c) { // a copy is a passive body: gravity, floor, slopes, ledges, net, pegs, walls
    c.vy += G * DT;
    c.vx *= 1 - 0.1 * DT;
    c.x += c.vx * DT;
    c.y += c.vy * DT;
    for (const q of pegs)
        pegBounce(c, q);
    const o = sawY(c.x), vo = sawV(c.x);
    c.y -= o; c.vy -= vo;
    const tg = collideTerrain(c, 0, vo);
    if (c.y + c.r > H) {
        c.y = H - c.r;
        if (c.vy > 0) c.vy = 0;
    }
    const gf = tg || c.y + c.r >= H - 1.5;
    c.y += o; c.vy += vo;
    const g2 = collideTerrain(c, 0, 0, LEDGES, LEDGE_T);
    collideTerrain(c, 0.2, 0, NETSEGS, NET_T);
    collideTerrain(c, 0, 0, stuckSegs, ARROW_HALF_W);
    delete c.hit;
    if (gf || g2)
        c.vx *= 1 - GROUND_BRAKE * DT;
    if (c.y - c.r < 0) { c.y = c.r; if (c.vy < 0) c.vy *= -0.05; }
    if (c.x < c.r) { c.x = c.r; if (c.vx < 0) c.vx *= -0.2; }
    if (c.x > W - c.r) { c.x = W - c.r; if (c.vx > 0) c.vx *= -0.2; }
}
function stepSplit() { // once per tick, after the bodies have moved
    for (const p of players) {
        p.splitLock = Math.max(0, p.splitLock - DT);
        if (!p.has('split')) {
            if (p.s < 1 || p.clones.length)
                splitCollapse(p);
            continue;
        }
        if (!p.alive || !p.clones.length)
            continue;
        for (const c of p.clones) {
            stepClone(c);
            c.lock = Math.max(0, (c.lock || 0) - DT);
        }
        for (const q of players) // copies are solid for everybody else
            if (q !== p && q.alive)
                for (const c of p.clones)
                    collide(q, c, PLAYER_M, PLAYER_M * c.s, PLAYER_BOUNCE);
        if (!(p.awakeT > 0)) // the Death Ball and enemy decoys destroy a copy (Awakened protects them too)
            p.clones = p.clones.filter(c => Math.hypot(c.x - ball.x, c.y - ball.y) >= c.r + ball.r && !decoys.some(d => d.team !== p.team && Math.hypot(c.x - d.x, c.y - d.y) < c.r + d.r));
        // copies touching each other fuse into one (their areas add)
        for (let i = 0; i < p.clones.length; i++)
            for (let j = p.clones.length - 1; j > i; j--) {
                const a = p.clones[i], b = p.clones[j];
                if (a.lock > 0 || b.lock > 0 || Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r + SPLIT_MERGE_GAP)
                    continue;
                const t = a.s + b.s;
                a.x = (a.x * a.s + b.x * b.s) / t; a.y = (a.y * a.s + b.y * b.s) / t;
                a.vx = (a.vx * a.s + b.vx * b.s) / t; a.vy = (a.vy * a.s + b.vy * b.s) / t;
                const old = Math.max(a.r, b.r);
                a.s = Math.min(1, t); a.r = splitR(a.s);
                a.y -= a.r - old; // grow upward; the terrain pushes it out of anything else next tick
                a.lock = SPLIT_SWITCH_LOCK;
                p.clones.splice(j, 1);
            }
        if (p.splitLock <= 0)
            for (let i = p.clones.length - 1; i >= 0; i--) { // touching a copy merges it into you
                const c = p.clones[i];
                if (c.lock > 0 || Math.hypot(c.x - p.x, c.y - p.y) > p.r + c.r + SPLIT_MERGE_GAP)
                    continue;
                const old = p.r, total = Math.min(1, p.s + c.s);
                p.vx = (p.vx * p.s + c.vx * c.s) / (p.s + c.s);
                p.vy = (p.vy * p.s + c.vy * c.s) / (p.s + c.s);
                p.s = total; p.r = splitR(total);
                if (p.ground)
                    p.y -= p.r - old;
                p.clones.splice(i, 1);
            }
    }
}