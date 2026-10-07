// PHYSICS - Ball: the death ball (and decoys, which are Ball instances with .decoy = true).
// step() returns the team that scored if the ball crossed a threshold line, otherwise null.
class Ball {
    constructor() {
        this.x = NETX;
        this.y = H - RISE - 13;
        this.vx = 0;
        this.vy = 0;
        this.r = BALL_R;
        this.th = 0;
        this.w = 0;
        this.boost = 0;
    }
    reset() { this.x = NETX; this.y = H - RISE - 13; this.vx = 0; this.vy = 0; this.th = 0; this.w = 0; this.boost = 0; } // rests in the notch of the middle peak
    // Returns the team that scored if the ball entered a goal. No bounce; the net does not affect the ball.
    step() {
        this.vy += BALL_G * DT; // low gravity + light drag = long hang time
        this.vx *= 1 - 0.05 * DT;
        this.vy *= 1 - 0.05 * DT;
        const s = Math.hypot(this.vx, this.vy), cap = BALL_VMAX + (PAD_MAX - BALL_VMAX) * this.boost; // a hatchet hit lifts the cap for a moment
        this.boost = Math.max(0, this.boost - DT / PAD_BOOST_T);
        if (s > cap) {
            this.vx *= cap / s;
            this.vy *= cap / s;
        }
        this.x += this.vx * DT;
        this.y += this.vy * DT;
        this.w = Math.max(-45, Math.min(45, this.w * (1 - 0.3 * DT)));
        this.th += this.w * DT; // spin carries in the air
        if (this.y - this.r < 0) {
            this.y = this.r;
            if (this.vy < 0)
                this.vy = 0;
        }
        for (const q of pegs)
            if (pegBounce(this, q)) { // glancing hits also give the ball some spin
                const nx = (this.x - q.x) / (Math.hypot(this.x - q.x, this.y - q.y) || 1), ny = (this.y - q.y) / (Math.hypot(this.x - q.x, this.y - q.y) || 1);
                this.w += (this.vx * -ny + this.vy * nx) * 0.04;
            }
        const o = sawY(this.x), vo = sawV(this.x); // floor frame, as for players
        this.y -= o;
        this.vy -= vo;
        this.hit = 0;
        if (this.x > 0 && this.x < W && this.y + this.r > H) {
            this.hit = Math.max(0, this.vy + vo);
            this.y = H - this.r;
            if (this.vy > 0)
                this.vy = 0;
            this.vx *= 1 - BALL_ROLL_DRAG * DT;
            roll(this, 0, -1);
        }
        collideTerrain(this, 0, vo);
        collideTerrain(this, 0, vo, OUTSEGS);
        padBounce(this);
        this.y += o;
        this.vy += vo;
        sawHit(this.x, BALL_M * this.hit);
        collideTerrain(this, 0, 0, LEDGES, LEDGE_T);
        collideTerrain(this, 0, 0, OUTCEIL, LEDGE_T);
        if (this.y > H + PIT + 40) { // failsafe
            if (this.decoy)
                this.dead = true; // a decoy that falls out of the world is just removed
            else
                this.reset();
        }
        if (this.x < -OUT_D)
            return 1; // ball crossed the left threshold line: right team scores
        if (this.x > W + OUT_D)
            return 0;
        return null;
    }
}
