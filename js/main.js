// MAIN - wires the renderer to the simulation and runs the fixed-timestep loop.
// Hook the renderer into the game's events (the game never calls the renderer directly).
events.onPoint = (team, why) => {
    hud.flash[team] = 1;
    if (why === 'scores!')
        hud.line[1 - sideSwap(team)] = 1; // the threshold line that was crossed lights up
};
events.onBodyStep = trailPush;
events.onPauseTick = trailMelt;
events.onNewRound = () => { trailClear(); impactsClear(); };
events.onBatHit = spawnBatImpact;
events.onImpact = spawnImpact;

let last = performance.now(), acc = 0;
function frame(t) {
    acc += Math.min(0.05, (t - last) / 1000);
    last = t;
    if (net.on) { // NET: online, the server runs the simulation; we only draw what it sends
        acc = 0;
        net.frame(performance.now());
    } else
        while (acc >= DT) {
            update();
            acc -= DT;
        }
    draw();
    requestAnimationFrame(frame);
}

newRound();
requestAnimationFrame(frame);

