// GAME - rules and the fixed-step update loop: rounds, scoring, kills, decoy collisions.
// Drives the physics modules and never draws. The renderer subscribes through `events`.
const WIN = 9; // points to win the match
let score = [0, 0], pause = 0, over = false, msg = '';
let teamSize = 1; // 1 = 1v1, 2 = 2v2
// Hooks the renderer fills in (see main.js). They default to no-ops so the simulation runs headless.
const events = {
    onPoint(team, why) {}, // a point was awarded
    onBodyStep(b) {}, // a body (player, death ball or decoy) just advanced one step
    onPauseTick() {}, // one step of the between-rounds pause
    onNewRound() {}, // the round was reset
    onImpact(p, x, y, ux, uy, speed) {}, // player p hit something at (x, y) hard enough to show it; (ux, uy) points away from what it hit, speed = how hard (u/s)
    onBatHit(p, target, x, y, ux, uy, power) {}, // p's bat hit a ball / decoy / player at (x, y), launching it along (ux, uy); power 0..1
};
function newRound() { 
    pegs.length = 0; 
    decoys.length = 0; 
    clearArrows();
    ai.forEach((a, i) => aiReset(i)); // forget any look-ahead / plan from the last round
    players.forEach(p => p.reset()); 
    ball.reset(); 
    sawReset(); 
    events.onNewRound(); 
}
function point(t, why) {
    score[t]++;
    events.onPoint(t, why);
    over = score[t] >= WIN;
    msg = `${t === 0 ? 'Blue' : 'Red'} ${why}` + (over ? ' - wins the match!' : '');
    pause = over ? 4 : 1.6;
}
function setTeamSize(size) { // 1 = 1v1, 2 = 2v2: restarts the match
    teamSize = size;
    layoutTeams(size);
    resetMatch();
}
function resetMatch() { // R key
    score = [0, 0];
    over = false;
    msg = '';
    pause = 0;
    newRound();
}
// Barbwire: while its owner holds the special key, their grapple rope kills any other player it touches. The rope is the segment from the owner to the hook; while the hook is
// still in flight it is the part of the line that has reached out so far (the same line the renderer draws). A player counts as touching it when the segment passes within
// their radius (plus BARBWIRE_HALF_W for the rope's own thickness).
function ropeEnd(p) { // where the owner's rope currently ends: the pivot, or the hook's tip in flight; null = no rope out
    if (p.rope)
        return p.rope;
    if (p.pending && p.keys.z) {
        const f = Math.min(1, 1 - p.pending.t / p.pending.t0);
        return { x: p.x + (p.pending.p.x - p.x) * f, y: p.y + (p.pending.p.y - p.y) * f };
    }
    return null;
}
function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function barbedRopeKills() {
    for (const p of players) {
        if (!p.alive || !p.cast || p.cast.type !== 'barbwire')
            continue;
        const e = ropeEnd(p);
        if (!e)
            continue;
        for (const q of players)
            if (q !== p && q.alive && (BARBWIRE_HITS_TEAMMATES || q.team !== p.team) && distToSeg(q.x, q.y, p.x, p.y, e.x, e.y) < q.r + BARBWIRE_HALF_W) {
                q.alive = false; // caught on the wire
                q.rope = null;
                q.pending = null;
                q.onBall = false;
                q.tball = null;
            }
    }
}
function update() {
    sawStep();
    for (const q of pegs) {
        q.flash = Math.max(0, q.flash - DT / 0.3);
        q.life -= DT;
    }
    for (let i = pegs.length - 1; i >= 0; i--)
        if (pegs[i].life <= 0)
            pegs.splice(i, 1); // fizzled out
    if (pause > 0) {
        pause -= DT;
        events.onPauseTick();
        if (pause <= 0) {
            if (over) {
                score = [0, 0];
                over = false;
            }
            msg = '';
            newRound();
        }
        return;
    }
    for (const p of players)
        if (ai[p.id].on && p.alive)
            aiDrive(p.id);
    for (const p of players)
        if (p.alive) {
            p.step(ball);
            events.onBodyStep(p);
        }
    barbedRopeKills(); // before the body collisions below, so a barbed rope wins over the "touching an enemy overcharges your grapple" rule
    for (let i = 0; i < players.length; i++) // players are solid: everyone bumps everyone (teammates too)
        for (let j = i + 1; j < players.length; j++)
            if (players[i].alive && players[j].alive) {
                const a = players[i], b = players[j];
                if (a.team !== b.team && Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r + 0.5) { // touching an enemy with the grapple out (rope, or hook in flight) overcharges you: no body-blocking on a rope
                    if (a.rope || a.pending)
                        a.overcharge();
                    if (b.rope || b.pending)
                        b.overcharge();
                }
                const hit = collide(a, b, PLAYER_M, PLAYER_M, PLAYER_BOUNCE);
                if (hit > IMPACT_V0) { // each player's sparks fly off on their own side of the contact
                    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
                    events.onImpact(a, a.x + nx * a.r, a.y + ny * a.r, -nx, -ny, hit);
                    events.onImpact(b, b.x - nx * b.r, b.y - ny * b.r, nx, ny, hit);
                }
            }
    stepArrows();
    const scorer = ball.step();
    events.onBodyStep(ball);
    if (ball.pull)
        ball.pull.t = Math.max(0, ball.pull.t - DT);
    if (scorer !== null)
        return point(scorer, 'scores!');
    for (const d of [...decoys]) { // decoys: the same physics and goals as the death ball, but no kill
        const sc = d.step();
        events.onBodyStep(d);
        if (d.dead)
            removeDecoy(d);
        else if (sc !== null)
            return point(sc, 'scores!');
    }
    for (let i = 0; i < decoys.length; i++) { // decoys are solid: they bump into players, the death ball and each other (the death ball itself still just kills)
        const d = decoys[i];
        for (const p of players)
            if (p.alive) {
                const hit = collide(p, d, 1, BALL_M, DECOY_BOUNCE_PLAYER);
                if (hit > IMPACT_V0) {
                    const dx = d.x - p.x, dy = d.y - p.y, m = Math.hypot(dx, dy) || 1;
                    events.onImpact(p, p.x + dx / m * p.r, p.y + dy / m * p.r, dx / m, dy / m, hit); // sparks fly the way the decoy is pushed
                }
            }
        collide(ball, d, BALL_M, BALL_M, DECOY_BOUNCE_BALL);
        for (let j = i + 1; j < decoys.length; j++)
            collide(d, decoys[j], BALL_M, BALL_M, DECOY_BOUNCE_BALL);
    }
    for (const p of players) { // the Death Ball kills on any touch, but the player's momentum goes into it first (crash shot)
        if (p.alive && Math.hypot(p.x - ball.x, p.y - ball.y) < p.r + ball.r) {
            const hit = crashShot(p, ball);
            if (hit > IMPACT_V0) {
                const dx = ball.x - p.x, dy = ball.y - p.y, m = Math.hypot(dx, dy) || 1;
                events.onImpact(p, p.x + dx / m * p.r, p.y + dy / m * p.r, dx / m, dy / m, hit);
            }
            p.alive = false;
            p.rope = null;
            p.onBall = false;
        }
    }
    const teamAlive = t => players.some(p => p.team === t && p.alive); // a team is out when all its players are dead
    if (!teamAlive(0) && !teamAlive(1)) {
        msg = 'Double KO';
        pause = 1.6;
    }
    else if (!teamAlive(0))
        point(1, 'wipes out the other team!');
    else if (!teamAlive(1))
        point(0, 'wipes out the other team!');
}
