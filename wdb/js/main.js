// MAIN - wires the renderer to the simulation and runs the fixed-timestep loop.
// Hook the renderer into the game's events (the game never calls the renderer directly).
events.onPoint = (team, why) => {
    hud.flash[team] = 1;
    if (why === 'scores!')
        hud.line[1 - team] = 1; // the threshold line that was crossed lights up
};
events.onBodyStep = trailPush;
events.onPauseTick = trailMelt;
events.onNewRound = trailClear;

let last = performance.now(), acc = 0;
function frame(t) {
    acc += Math.min(0.05, (t - last) / 1000);
    last = t;
    while (acc >= DT) {
        update();
        acc -= DT;
    }
    draw();
    requestAnimationFrame(frame);
}

newRound();
requestAnimationFrame(frame);
