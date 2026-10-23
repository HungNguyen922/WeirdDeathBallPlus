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

(function warmUpPointFx() { // pay the one-time costs (font lookup, JIT, first gradients) at load, not on the first goal
    const sMsg = msg, sPause = pause, sOver = over;
    try {
        cx.save();
        cx.translate(OX, HUD);
        for (const [t, win] of [[0, false], [1, true]]) {
            msg = (t === 0 ? 'Blue' : 'Red') + ' scores!';
            over = win;
            pause = 1; // e = 0.6 s into a goal, 3 s into a win (so confetti and fireworks run too)
            drawPointFx();
        }
        drawBanner('GET READY', 0.5, 0); // same font, used by the pick screens and side changes
        cx.restore();
        cx.clearRect(0, 0, cv.width, cv.height);
    } catch (e) {
        console.warn('point fx warm-up failed', e);
    } finally {
        msg = sMsg; pause = sPause; over = sOver;
    }
})();
newRound();
requestAnimationFrame(frame);
