// apply-skins.js - adds player skins to the game. Run it ONCE from the project folder (the one with index.html):   node apply-skins.js
// 1. unzip skins.zip into the project folder first (it only ADDS new files: js/skin-data.js, js/skin-editor.js, js/render/skin.js, the pieces of the old js/render/entities.js, js/test/skin-test.js)
// 2. run this: it makes small edits to 8 existing files (css/style.css just gets the skin styles added at its end; index.html, js/server/accounts.js, js/server/server.js, js/net/account.js, js/net/client.js, js/physics/portals.js, js/physics/swap.js)
//    and renames js/render/entities.js to entities.js.old (it is replaced by the new files).
// It is all-or-nothing: every edit is checked first, nothing is written unless all of them fit, and each changed file is first copied to <name>.bak.
// Works with both Windows (CRLF) and Unix line endings. If it says an edit "was found 0 times", that file has changed since this was written: send me the message.
const fs = require('fs'), path = require('path');
const EDITS = {
 "index.html": [
  [
   "<button class=\"tab\" role=\"tab\" data-tab=\"players\" aria-selected=\"false\">Players</button>\n<button class=\"tab\" role=\"tab\" data-tab=\"account\" aria-selected=\"false\">Account</button>",
   "<button class=\"tab\" role=\"tab\" data-tab=\"players\" aria-selected=\"false\">Players</button>\n<button class=\"tab\" role=\"tab\" data-tab=\"skin\" aria-selected=\"false\">Skin</button>\n<button class=\"tab\" role=\"tab\" data-tab=\"account\" aria-selected=\"false\">Account</button>"
  ],
  [
   "\n<section data-panel=\"account\" hidden>",
   "\n<section data-panel=\"skin\" hidden>\n<div id=\"skinedit\"></div>\n</section>\n\n<section data-panel=\"account\" hidden>"
  ],
  [
   "<script src=\"js/game/ai.js\"></script>\n<script src=\"js/render/canvas.js\"></script>",
   "<script src=\"js/game/ai.js\"></script>\n<script src=\"js/skin-data.js\"></script>\n<script src=\"js/render/canvas.js\"></script>"
  ],
  [
   "<script src=\"js/render/entities.js\"></script>",
   "<script src=\"js/render/projectiles.js\"></script>\n<script src=\"js/render/casts.js\"></script>\n<script src=\"js/render/special-fx.js\"></script>\n<script src=\"js/render/portals-swaps.js\"></script>\n<script src=\"js/render/ropes.js\"></script>\n<script src=\"js/render/player-fx.js\"></script>\n<script src=\"js/render/skin.js\"></script>\n<script src=\"js/render/players.js\"></script>\n<script src=\"js/render/balls.js\"></script>"
  ],
  [
   "<script src=\"js/account-ui.js\"></script>\n<script src=\"js/main.js\"></script>",
   "<script src=\"js/account-ui.js\"></script>\n<script src=\"js/skin-editor.js\"></script>\n<script src=\"js/main.js\"></script>"
  ]
 ],
 "js/server/accounts.js": [
  [
   "// Data:  players/{uid}      { name, nameLower, settings, rating, matches, wins, losses, pointsFor, pointsAgainst, createdAt, updatedAt }",
   "// Data:  players/{uid}      { name, nameLower, settings, skin, rating, matches, wins, losses, pointsFor, pointsAgainst, createdAt, updatedAt }"
  ],
  [
   "\nconst NAME_RE = /^[A-Za-z0-9_]{3,16}$/;",
   "\nconst { skinClean } = require('../skin-data.js'); // the one definition of a valid skin, shared with the browser\nconst NAME_RE = /^[A-Za-z0-9_]{3,16}$/;"
  ],
  [
   "const pub = p => ({ name: p.name, rating: p.rating, matches: p.matches, wins: p.wins, losses: p.losses, pointsFor: p.pointsFor, pointsAgainst: p.pointsAgainst, settings: p.settings || {} });",
   "const pub = p => ({ name: p.name, rating: p.rating, matches: p.matches, wins: p.wins, losses: p.losses, pointsFor: p.pointsFor, pointsAgainst: p.pointsAgainst, settings: p.settings || {}, skin: skinClean(p.skin) });"
  ],
  [
   "async function identify(token) { // for the websocket join: { uid, name } (name is null until they have chosen one), or null for a guest",
   "async function identify(token) { // for the websocket join: { uid, name, skin } (name is null until they have chosen one; skin is [] for none), or null for a guest"
  ],
  [
   "    return { uid, name: p ? p.name : null };",
   "    return { uid, name: p ? p.name : null, skin: p ? skinClean(p.skin) : [] };"
  ],
  [
   "            tx.set(pref, { name, nameLower: key, settings: {}, rating: START_RATING, matches: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, createdAt: now, updatedAt: now });",
   "            tx.set(pref, { name, nameLower: key, settings: {}, skin: [], rating: START_RATING, matches: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, createdAt: now, updatedAt: now });"
  ],
  [
   "    await ref.update({ settings, updatedAt: Date.now() });\n}",
   "    await ref.update({ settings, updatedAt: Date.now() });\n}\n\nasync function saveSkin(uid, raw) { // anything that is not a list is refused; a list is cleaned (bad layers dropped, numbers clamped) and what was actually stored is returned\n    if (!Array.isArray(raw))\n        throw userError('Bad skin.');\n    const skin = skinClean(raw), ref = players().doc(uid);\n    if (!(await ref.get()).exists)\n        throw userError('Pick a name first.');\n    await ref.update({ skin, updatedAt: Date.now() });\n    return skin;\n}"
  ],
  [
   "// The HTTP routes the browser uses:  GET /api/leaderboard (public)  GET /api/me  POST /api/name {name}  POST /api/settings {settings}   (the last three need \"Authorization: Bearer <token>\")",
   "// The HTTP routes the browser uses:  GET /api/leaderboard (public)  GET /api/me  POST /api/name {name}  POST /api/settings {settings}  POST /api/skin {skin}   (the last four need \"Authorization: Bearer <token>\")"
  ],
  [
   "        }\n        send(404, { error: 'not found' });",
   "        }\n        if (pathname === '/api/skin')\n            return send(200, { skin: await saveSkin(uid, body.skin) });\n        send(404, { error: 'not found' });"
  ]
 ],
 "js/server/server.js": [
  [
   "//                      {t:'ping', c}                       latency probe\n//   server -> client   {t:'welcome', room, slot, cid, tick, hz, snapEvery}   slot: 0..3 = a seat, -1 = waiting / spectating; cid = your member id",
   "//                      {t:'ping', c}                       latency probe\n//                      {t:'refresh', token}                I changed my name or skin on my account: look me up again (the token must belong to the same account) and send everyone a fresh roster\n//   server -> client   {t:'welcome', room, slot, cid, tick, hz, snapEvery}   slot: 0..3 = a seat, -1 = waiting / spectating; cid = your member id"
  ],
  [
   "//                      {t:'roster', slots:[bool x4], spectators, running, lobby2v2, host, you, members:[{c, team, slot, host}]}",
   "//                      {t:'roster', slots:[bool x4], spectators, running, lobby2v2, host, you, members:[{c, team, slot, host, name, skin}]}   skin = the account's skin (a list of layers, see js/skin-data.js) or null"
  ],
  [
   "            .map(c => ({ c: c.cid, team: c.team, slot: c.slot, host: c === this.host, name: c.name || null }));",
   "            .map(c => ({ c: c.cid, team: c.team, slot: c.slot, host: c === this.host, name: c.name || null, skin: c.skin && c.skin.length ? c.skin : null }));"
  ],
  [
   "                conn.name = id && id.name ? id.name : null;\n                const name = typeof m.room === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(m.room) ? m.room : 'lobby';",
   "                conn.name = id && id.name ? id.name : null;\n                conn.skin = id ? id.skin : []; // (already cleaned by accounts.js)\n                const name = typeof m.room === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(m.room) ? m.room : 'lobby';"
  ],
  [
   "            else if (m.t === 'ping')",
   "            else if (m.t === 'refresh' && room && conn.uid && typeof m.token === 'string') {\n                accounts.identify(m.token).then(id => { // only the same account may refresh its own seat; a different or bad token changes nothing\n                    if (!id || id.uid !== conn.uid || gone)\n                        return;\n                    conn.name = id.name || conn.name;\n                    conn.skin = id.skin;\n                    room.roster();\n                }).catch(() => {});\n            } else if (m.t === 'ping')"
  ]
 ],
 "js/net/account.js": [
  [
   "    profile: null,   // { name, rating, matches, wins, losses, pointsFor, pointsAgainst, settings } once the server has answered (null = signed in but no name yet)",
   "    profile: null,   // { name, rating, matches, wins, losses, pointsFor, pointsAgainst, settings, skin } once the server has answered (null = signed in but no name yet)"
  ],
  [
   "            this.pushSettings(); // a new account keeps this device's settings\n        this.changed();\n    },\n",
   "            this.pushSettings(); // a new account keeps this device's settings\n        this.changed();\n        if (typeof net !== 'undefined' && net.refreshIdentity)\n            net.refreshIdentity(); // a room you are already in learns the new name\n    },\n    async saveSkin(skin) { // the server cleans it and answers with what it actually stored\n        this.profile.skin = (await this.api('/api/skin', 'POST', { skin })).skin;\n        this.changed();\n        return this.profile.skin;\n    },\n"
  ]
 ],
 "js/net/client.js": [
  [
   "    },\n    sendChat(text) { // returns false when there is no open connection (chat.js then tells the player)",
   "    },\n    async refreshIdentity() { // my name or skin changed on my account: the server checks my token again and sends the room a fresh roster\n        if (!this.ws || this.ws.readyState !== 1 || typeof account === 'undefined')\n            return;\n        const token = await account.freshToken().catch(() => null);\n        if (token && this.ws && this.ws.readyState === 1)\n            this.ws.send(JSON.stringify({ t: 'refresh', token }));\n    },\n    sendChat(text) { // returns false when there is no open connection (chat.js then tells the player)"
  ]
 ],
 "js/physics/portals.js": [
  [
   "// PHYSICS - portals: the PORTAL special. Never draws (see drawPortals in render/entities.js).",
   "// PHYSICS - portals: the PORTAL special. Never draws (see drawPortals in render/portals-swaps.js)."
  ]
 ],
 "js/physics/swap.js": [
  [
   "// PHYSICS - swap: the SWAP special. Never draws (see drawSwaps in render/entities.js).",
   "// PHYSICS - swap: the SWAP special. Never draws (see drawSwaps in render/portals-swaps.js)."
  ]
 ]
};
const NEW_FILES = ['js/skin-data.js', 'js/skin-editor.js', 'js/render/skin.js', 'js/render/players.js', 'js/render/balls.js', 'js/render/projectiles.js', 'js/render/casts.js', 'js/render/special-fx.js', 'js/render/portals-swaps.js', 'js/render/ropes.js', 'js/render/player-fx.js'];
const CSS = "/* skin tab (js/skin-editor.js) */\n#skinedit .skinwrap { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }\n#skinedit .skinleft { flex: 0 0 300px; max-width: 100%; }\n#skinedit .skinright { flex: 1 1 260px; min-width: 0; }\n@media (min-width: 700px) { #skinedit .skinleft { position: sticky; top: 0; } } /* beside the controls: stays in view while you scroll them */\n#skincv { width: 300px; max-width: 100%; max-height: none; aspect-ratio: 1; cursor: grab; touch-action: none; }\n#skinedit .skinlist { display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; }\n#skinedit button.layer { display: flex; align-items: center; gap: 8px; text-align: left; padding: 2px 8px; border-width: 1px; }\n#skinedit button.layer.sel { border-color: #ffd54a; border-width: 2px; }\n#skinedit .chip { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--mut); flex: none; }\n#skinedit .srow { display: flex; align-items: center; gap: 8px; }\n#skinedit .srow > span:first-child { min-width: 62px; color: var(--mut); font-size: 13px; }\n#skinedit .srow input[type=range] { flex: 1 1 100px; min-width: 80px; }\n#skinedit .srow .val { min-width: 42px; font-variant-numeric: tabular-nums; font-size: 13px; }\n#skinedit input[type=color] { width: 44px; height: 28px; padding: 0; border: 1px solid var(--mut); border-radius: 6px; background: transparent; cursor: pointer; }\n#skinedit .skinctl > .row, #skinedit .skinctl > .srow { margin-top: 6px; }\n#skinedit button.mode { padding: 2px 9px; font-size: 13px; }\n";
const root = process.cwd(), problems = [], out = [];
for (const f of NEW_FILES)
    if (!fs.existsSync(path.join(root, f)))
        problems.push(`missing ${f}: unzip skins.zip into this folder first`);
if (!fs.existsSync(path.join(root, 'index.html')))
    problems.push('run this from the project folder (the one that contains index.html)');
if (!problems.length) {
    for (const [file, pairs] of Object.entries(EDITS)) {
        const p = path.join(root, file);
        if (!fs.existsSync(p)) { problems.push(`${file} not found`); continue; }
        let text = fs.readFileSync(p, 'utf8');
        if (text.includes('skin') && (file === 'js/server/accounts.js' || file === 'js/net/account.js' || file === 'js/net/client.js' || file === 'js/server/server.js') && /skinClean|saveSkin|refreshIdentity|conn\.skin/.test(text)) { problems.push(`${file} already has the skin changes (was this script run before?)`); continue; }
        const crlf = text.includes('\r\n'), conv = s => (crlf ? s.replace(/\r?\n/g, '\r\n') : s);
        pairs.forEach(([o, n], i) => {
            const old = conv(o), count = text.split(old).length - 1;
            if (count !== 1) problems.push(`${file}: edit ${i + 1} (starts "${o.split('\n')[0].trim().slice(0, 60)}") was found ${count} times, expected once`);
            else text = text.replace(old, () => conv(n));
        });
        out.push([p, text]);
    }
    const cssPath = path.join(root, 'css/style.css');
    if (!fs.existsSync(cssPath)) problems.push('css/style.css not found');
    else {
        let t = fs.readFileSync(cssPath, 'utf8');
        if (!t.includes('#skincv')) { // the skin styles are simply added at the end, wherever your file ends
            const crlf = t.includes('\r\n');
            t = t.replace(/\s*$/, '') + (crlf ? '\r\n\r\n' : '\n\n') + (crlf ? CSS.replace(/\r?\n/g, '\r\n') : CSS);
            out.push([cssPath, t]);
        }
    }
    const ent = path.join(root, 'js/render/entities.js');
    if (!fs.existsSync(ent))
        problems.push('js/render/entities.js not found (already renamed?)');
}
if (problems.length) {
    console.log('Nothing was changed. Problems:\n  ' + problems.join('\n  '));
    process.exit(1);
}
for (const [p, text] of out) {
    fs.copyFileSync(p, p + '.bak');
    fs.writeFileSync(p, text);
    console.log('edited  ' + path.relative(root, p));
}
fs.renameSync(path.join(root, 'js/render/entities.js'), path.join(root, 'js/render/entities.js.old'));
console.log('renamed js/render/entities.js -> entities.js.old');
console.log('\nDone. Now run:  node js/test/skin-test.js   and   npm test');
