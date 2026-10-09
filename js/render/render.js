// RENDER - one frame, back to front.
function draw() {
    cx.save();
    cx.translate(OX, HUD); // arena coordinates stay 0..W, 0..H; the margins are negative x / x > W
    cx.beginPath(); cx.rect(-OX, 0, CW, H + PIT); cx.clip();
    drawArena();
    drawHud(); // the score lives on the floor now, so it is drawn in arena coordinates, right after the arena it sits on
    drawPegs();
    drawAITags();
    drawCasts();
    drawGrappleRange();
    drawRopes();
    drawDashStreaks();
    drawPlayerTrails();
    drawPlayers();
    drawBalls();
    drawImpacts();
    drawArrows();
    drawMessage();
    drawSpecialMenu();
    cx.restore();
}
