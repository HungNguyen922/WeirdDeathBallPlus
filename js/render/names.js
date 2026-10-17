// RENDER - player names: the account name under each character, online. Display only.
const NAME_FONT = '600 13px system-ui, sans-serif'; // size of the names (arena units; change the 13)
const NAME_GAP = 13;          // how far below the character's edge the text sits
const NAME_SHOW_GUEST = true; // label players who are not signed in "Guest" (dimmer). false = no label for them
function drawNames() {
    if (typeof net === 'undefined' || !net.on || !net.members.length)
        return;
    cx.save();
    cx.font = NAME_FONT;
    cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
    cx.lineWidth = 3.5; cx.strokeStyle = 'rgba(8,10,16,.85)'; // a dark outline keeps it readable on any background
    for (const p of players) {
        if (!p.alive)
            continue;
        const m = net.members.find(x => x.slot === p.id); // seat number = player id
        const txt = m ? (m.name || (NAME_SHOW_GUEST ? 'Guest' : '')) : '';
        if (!txt)
            continue;
        cx.fillStyle = m.name ? '#ffffff' : 'rgba(255,255,255,.55)';
        cx.strokeText(txt, p.x, p.y + p.r + NAME_GAP);
        cx.fillText(txt, p.x, p.y + p.r + NAME_GAP);
    }
    cx.restore();
}