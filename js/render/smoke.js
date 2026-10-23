// RENDER - Smoke Screen: the cloud around a smoker, and the two things it hides from the OTHER team: everything inside it, and the smoker's key hints on the wall.
// Read-only on game state (p.smokeT, set in physics/player-casts.js). Which team is "looking" is decided here (smokeViewer): the game itself never hides anything.
// NOTE: the snapshot the client receives still holds every position and key, so this is a screen-level fog (like fog of war in a casual game), not a cheat-proof one.
// Load order: before render.js (draw() calls these).
const smokeEase = u => 1 - (1 - u) * (1 - u);
// The team whose eyes the smog fools: online = my seat's team (a spectator sees everything); offline = the human team when the other team is all computer. With two people on one
// screen nobody can be hidden from anybody, so there the cloud is only drawn (see through), never hides anything. Returns 0, 1 or null.
function smokeViewer() {
    if (net.on)
        return net.slot >= 0 ? allPlayers[net.slot].team : null;
    const cpu = t => players.filter(p => p.team === t).every(p => ai[p.id].on);
    return cpu(0) !== cpu(1) ? (cpu(0) ? 1 : 0) : null;
}
const smokeHides = (p, v) => v !== null && p.team !== v; // does p's cloud hide things from the viewer's team?
const smokeHidesKeys = p => p.smokeT > 0 && smokeHides(p, smokeViewer());
// The cloud's current look: radius (billows out in SMOKE_FADE s, shrinks away in the last SMOKE_FADE s) and opacity.
function smokeShape(p) {
    const fin = Math.min(1, (SMOKE_T - p.smokeT) / SMOKE_FADE), fout = Math.min(1, p.smokeT / SMOKE_FADE);
    return { r: SMOKE_R * smokeEase(Math.max(0, fin)) * (0.55 + 0.45 * fout), a: fout };
}
// Cut every hidden cloud out of what is drawn next (until smokeEndHide). Returns whether anything was cut. Each cloud is its own clip, and clips intersect, so overlapping clouds cut their union.
function smokeBeginHide() {
    const v = smokeViewer(), list = v === null ? [] : players.filter(p => p.alive && p.smokeT > 0 && smokeHides(p, v));
    if (!list.length)
        return false;
    cx.save();
    for (const p of list) {
        cx.beginPath();
        cx.rect(-OX - 20, -20, CW + 40, H + PIT + 40);
        cx.arc(p.smokeX, p.smokeY, smokeShape(p).r * 0.9, 0, Math.PI * 2, true); // (the soft rim of the cloud is drawn out to 1.0, so objects never pop out under a clear edge)
        cx.clip('evenodd');
    }
    return true;
}
function smokeEndHide(cut) {
    if (cut)
        cx.restore();
}
function drawSmoke() {
    const v = smokeViewer(), t = performance.now();
    for (const p of players) {
        if (!(p.alive && p.smokeT > 0))
            continue;
        const { r, a } = smokeShape(p), solid = smokeHides(p, v), k = (solid ? 0.97 : 0.3) * a; // a cloud that hides from you is nearly opaque, one that does not is a see-through haze
        if (r < 1)
            continue;
        cx.save();
        cx.beginPath(); cx.rect(0, 0, W, H); cx.clip(); // the cloud stays inside the arena (the wall mass with the key hints is not covered)
        const base = cx.createRadialGradient(p.smokeX, p.smokeY, 0, p.smokeX, p.smokeY, r);
        base.addColorStop(0, `rgba(86,92,104,${k})`); base.addColorStop(0.82, `rgba(96,102,114,${k})`); base.addColorStop(1, 'rgba(96,102,114,0)');
        cx.fillStyle = base;
        cx.beginPath(); cx.arc(p.smokeX, p.smokeY, r, 0, 7); cx.fill();
        for (let i = 0; i < 16; i++) { // lighter puffs rolling slowly round and in and out, so the cloud looks alive
            const ang = i * 2.399 + t * 0.00018 * (i % 2 ? 1 : -1), d = r * (0.18 + 0.62 * ((i * 0.37) % 1)) + r * 0.05 * Math.sin(t * 0.0017 + i * 1.7), pr = r * (0.24 + 0.1 * ((i * 0.53) % 1));
            const px = p.smokeX + Math.cos(ang) * d, py = p.smokeY + Math.sin(ang) * d, g = cx.createRadialGradient(px, py, 0, px, py, pr);
            g.addColorStop(0, `rgba(176,182,192,${0.55 * k})`); g.addColorStop(1, 'rgba(176,182,192,0)');
            cx.fillStyle = g;
            cx.beginPath(); cx.arc(px, py, pr, 0, 7); cx.fill();
        }
        cx.restore();
    }
}
