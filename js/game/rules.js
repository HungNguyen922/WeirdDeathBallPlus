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
};
function newRound() { 
    pegs.length = 0; 
    decoys.length = 0; 
    clearArrows();
    ai.forEach(a => { 
        a.plan = null; a.t = 0; 
    }); 
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
    for (let i = 0; i < players.length; i++) // players are solid: everyone bumps everyone (teammates too)
        for (let j = i + 1; j < players.length; j++)
            if (players[i].alive && players[j].alive)
                collide(players[i], players[j], 1, 1, 0.4);
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
            if (p.alive)
                collide(p, d, 1, BALL_M, DECOY_BOUNCE_PLAYER);
        collide(ball, d, BALL_M, BALL_M, DECOY_BOUNCE_BALL);
        for (let j = i + 1; j < decoys.length; j++)
            collide(d, decoys[j], BALL_M, BALL_M, DECOY_BOUNCE_BALL);
    }
    for (const p of players) { // the Death Ball kills on any touch, but the player's momentum goes into it first (crash shot)
        if (p.alive && Math.hypot(p.x - ball.x, p.y - ball.y) < p.r + ball.r) {
            crashShot(p, ball);
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
