// PHYSICS - the simulated bodies: up to four players (1v1 or 2v2), the death ball, plinko pegs and decoys.
const pegs = []; // floating bounce pegs {x, y, vx, vy, r, team, owner, flash, life}
const decoys = []; // decoy balls (Ball instances with .decoy = true, .team and .owner)
// Player ids: 0 = Blue, 1 = Red (always in play); 2 = Blue's teammate, 3 = Red's teammate (2v2 only).
const BLUE = '#42a5f5', RED = '#ef5350';
const p1 = new Player(0, 250, BLUE, 0), p2 = new Player(1, 750, RED, 1);
const p3 = new Player(0, 0, BLUE, 2), p4 = new Player(1, 0, RED, 3);
const allPlayers = [p1, p2, p3, p4];
const players = [p1, p2], ball = new Ball(); // `players` = who is in the current match (edited in place by layoutTeams)
// 2v2 spawns: one player this far from the ball (center to center), the other this far from the goal scoop (measured from where the ramp meets the floor).
const SPAWN_BALL_D = 4 * PL, SPAWN_SCOOP_D = 2 * PL;
function layoutTeams(size) { // size 1 = 1v1, 2 = 2v2; takes effect on the next newRound()
    players.length = 0;
    players.push(p1, p2);
    if (size === 2)
        players.push(p3, p4);
    p1.sx = size === 2 ? NETX - SPAWN_BALL_D : 250;
    p2.sx = size === 2 ? NETX + SPAWN_BALL_D : 750;
    p3.sx = RUN + SPAWN_SCOOP_D;
    p4.sx = W - RUN - SPAWN_SCOOP_D;
}
function removeDecoy(d) { // gone (recast, fell out, round over): anyone tethered to it lets go
    const i = decoys.indexOf(d);
    if (i >= 0)
        decoys.splice(i, 1);
    for (const p of allPlayers)
        if (p.tball === d) {
            p.rope = null;
            p.onBall = false;
            p.tball = null;
        }
}
function spawnDecoy(owner, x, y) { // one decoy per player: a new one replaces that player's old one
    for (const d of decoys.filter(d => d.owner === owner))
        removeDecoy(d);
    const d = new Ball();
    d.x = x; d.y = y;
    d.decoy = true;
    d.team = owner.team;
    d.owner = owner;
    decoys.push(d);
}
