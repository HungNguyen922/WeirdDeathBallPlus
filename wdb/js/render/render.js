// RENDER - one frame, back to front.
function draw() {
    drawHud();
    cx.save();
    cx.translate(OX, HUD); // arena coordinates stay 0..W, 0..H; the margins are negative x / x > W
    cx.beginPath(); cx.rect(-OX, 0, CW, H + PIT); cx.clip();
    drawArena();
    drawPegs();
    drawAITags();
    drawCasts();
    drawGrappleRange();
    drawRopes();
    drawDashStreaks();
    drawPlayerTrails();
    drawPlayers();
    drawBalls();
    drawMessage();
    drawSpecialMenu();
    cx.restore();
}
