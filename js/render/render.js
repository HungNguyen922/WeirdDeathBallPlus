// RENDER - one frame, back to front.
function draw() {
    cx.save();
    cx.translate(OX, HUD); // arena coordinates stay 0..W, 0..H; the margins are negative x / x > W
    cx.beginPath(); cx.rect(-OX, 0, CW, H + PIT); cx.clip();
    drawArena();
    drawQuakeFx(); // the seesaw floor's quake graphic: on the floor, behind everything that stands on it
    drawHud(); // the score (and the online status under it) live on the floor, drawn in arena coordinates right after the arena they sit on
    drawMenuTile(); // the Menu tile on Blue's wall, under the weight key
    const hid = smokeBeginHide(); // Smoke Screen: everything from here to drawBoomerangs is cut out of the other team's cloud
    drawPegs();    drawAITags();
    drawCasts();
    drawWarps();
    drawPortals();
    drawSwaps();
    drawAwakened();
    drawExplode();
    drawGrappleRange();
    drawRopes();
    drawDashStreaks();
    drawPlayerTrails();
    drawPlayers();
    drawBalls();
    drawImpacts();
    drawArrows();
    drawBoomerangs();
    smokeEndHide(hid);
    drawSmoke();
    drawMessage();
    drawPickScreen(); // the special-ability select grid, over the playing area, when one is open
    drawSideChangeBanner(performance.now()); // the "SIDE CHANGE" banner, over everything except the menu
    drawSpecialMenu();
    cx.restore();
}



