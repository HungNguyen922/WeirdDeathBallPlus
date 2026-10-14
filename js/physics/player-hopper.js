// PHYSICS - Player hopper: the HOPPER special (hop = pick a surface and fly at it, hopperEnd = finish the hop and work out what we cling to). Never draws.
// Adds methods to Player (see mixin() in player.js); load after player.js.
mixin(Player, {
    // Hopper: pick the surface to jump to and start flying at it.
    hop() {
        if (this.hopT > 0 || this.cd.hopper > 0)
            return false;
        const s = this.clinging ? this.surf : this.ground ? 'F' : this.surf; // clung surface first, else the floor, else whatever we touch
        if (!s)
            return false;
        const r = this.r, x = this.x, y = this.y;
        // The goal juts (see LEDGES): a player's centre rests LEDGE_T + r from a face. jl / jr = x against the left / right inner face, ju = y under an underside.
        const jl = PL + LEDGE_T + r, jr = W - PL - LEDGE_T - r, ju = GOAL_Y0 + LEDGE_T + r;
        const underJut = x <= PL || x >= W - PL; // a jut's flat underside is straight above us
        const upX = x > PL && x < jl ? jl : x < W - PL && x > jr ? jr : x; // beside a jut face but not under it: aim along the face, not into the corner
        const netY = Math.max(y, NET_GAP + r + 2); // the net only exists below its gap
        const target = {
            F: underJut ? { x, y: ju } : { x: upX, y: r },
            C: { x, y: H - r },
            JU: { x, y: H - r },
            L: { x: NETX - r, y: netY },
            JL: { x: NETX - r, y: netY },
            R: { x: NETX + r, y: netY },
            JR: { x: NETX + r, y: netY },
            NL: { x: y < GOAL_Y0 ? jl : r, y }, // above the goal alcove the left wall is the jut's face; below it, the real wall
            NR: { x: y < GOAL_Y0 ? jr : W - r, y },
        }[s];
        const dx = target.x - x, dy = target.y - y, m = Math.hypot(dx, dy);
        if (m < 2)
            return false;
        this.hopDir = [dx / m, dy / m];
        this.hopTo = target;
        this.hopFloor = s === 'C' || s === 'JU'; // hops that end on the floor do not stick
        this.hopT = HOPPER_HOP_T;
        this.clinging = false;
        this.cd.hopper = HOPPER_COOLDOWN;
        this.dashT = DASH_FX; this.dashDir = this.hopDir; // reuses the dash streak
        return true;
    },
    // Called at the end of step(): finish a hop, then work out what we are touching.
    hopperEnd(k) {
        if (!this.has('hopper'))
            return;
        if (this.hopT > 0) {
            this.hopT -= DT;
            const rem = (this.hopTo.x - this.x) * this.hopDir[0] + (this.hopTo.y - this.y) * this.hopDir[1];
            const moved = Math.hypot(this.x - this.hopPx, this.y - this.hopPy);
            const landed = rem <= 1;
            if (landed || moved < HOPPER_HOP_V * DT * 0.4 || this.hopT <= 0) { // arrived, blocked, or timed out
                this.hopT = 0;
                this.vx = this.vy = 0;
                this.stickGrace = landed && !this.hopFloor ? HOPPER_GRACE : 0;
            }
        }
        const r = this.r, hits = [];
        const jl = PL + LEDGE_T + r, jr = W - PL - LEDGE_T - r, ju = GOAL_Y0 + LEDGE_T + r; // resting spots against the goal juts (see hop())
        if (this.y - r <= 0.5) hits.push(['C', k.up]);
        if (this.x <= r + 0.5) hits.push(['L', k.l]);
        if (this.x >= W - r - 0.5) hits.push(['R', k.r]);
        if (this.y + r > NET_GAP + 0.5 && Math.abs(this.x - NETX) <= r + 1.5)
            hits.push(this.x < NETX ? ['NL', k.r] : ['NR', k.l]);
        if (this.y <= GOAL_Y0 && this.x >= PL && this.x <= jl + 1.5) hits.push(['JL', k.l]);   // left jut, inner face (we are on its arena side)
        if (this.y <= GOAL_Y0 && this.x <= W - PL && this.x >= jr - 1.5) hits.push(['JR', k.r]); // right jut, inner face
        if (this.y > GOAL_Y0 && this.y <= ju + 1.5 && (this.x <= PL || this.x >= W - PL)) hits.push(['JU', k.up]); // under either jut
        const pick = hits.find(h => h[1]) || hits[0]; // prefer a surface we are pushing into
        this.surf = pick ? pick[0] : null;
        this.clinging = !!pick && this.hopT <= 0 && (pick[1] || this.stickGrace > 0);
    },
});
