// apply-web.js - wires the WEB special and the statics registry into the game. Run ONCE from the project folder (the one with index.html):   node apply-web.js
// 1. First copy the four new files into the project, keeping their folders:
//      js/physics/statics.js   js/physics/web.js   js/render/web.js   js/test/web-test.js
// 2. Then run this. It makes small edits to 12 existing files (listed below). It is all-or-nothing: every edit is checked first, nothing is written unless all of them fit,
//    and each changed file is copied to <name>.bak first. Works with CRLF and LF. A file that already has its change is skipped, so running it twice is safe.
// 3. Then run:  npm test      (web-test.js is picked up automatically)
//
// Edited: js/physics/constants.js (WEB_* numbers + the ABILITY entry), js/server/sim-node.js (load order), js/game/rules.js (clear / step / pick grid), js/game/simstate.js (save + load),
//         js/physics/player-casts.js (the key press), js/render/special-menu.js (WEB in the list; dropdown rows 32 -> 30 px so 20 entries still fit on the canvas),
//         js/render/key-hints.js (icon), js/render/pick-screen.js (description), js/render/render.js (drawWebs), index.html (script tags), js/server/server.js (SPECIAL_IDS),
//         js/test/state-test.js (WEB joins the random-specials replay test)
const fs = require('fs'), path = require('path');
const root = process.cwd();

const NEW_FILES = ['js/physics/statics.js', 'js/physics/web.js', 'js/render/web.js', 'js/test/web-test.js'];

const WEB_CONSTANTS = [
    "// --- Web ---------------------------------------------------------------------------------------------------------------------------------------------------------",
    "// Press the special key to drop a node where you stand. Every node is joined by a line to each OLDER node of yours, so n nodes make n(n-1)/2 lines. A body whose centre crosses a",
    "// line loses WEB_SLOW of its velocity, once per crossing. At WEB_MAX nodes the next press replaces your oldest. See physics/statics.js (the registry) and physics/web.js.",
    "const WEB_MAX = 5;                    // nodes per player: the next one replaces the oldest",
    "const WEB_SLOW = 0.05;                // share of its velocity a body loses each time it crosses a line (0.05 = 5%)",
    "const WEB_COOLDOWN = 0.5;             // s between nodes (starts when a node is dropped)",
    "const WEB_LIFE = 0;                   // s a node lasts (0 = until the round ends or it is replaced)",
    "const WEB_HITS_OWN_TEAM = true;       // the lines slow the owner and their teammates too (false = enemies and the death ball only)",
    "const WEB_NODE_R = 6;                 // node radius as DRAWN (u; display only)",
    "",
    "// --- The ability table:"
].join('\n');

const EDITS = {
    'js/physics/constants.js': { marker: 'WEB_MAX', pairs: [
        ["// --- The ability table:", WEB_CONSTANTS],
        ["fighter: { cd: FIGHTER_COOLDOWN} }", "web: { cd: WEB_COOLDOWN }, fighter: { cd: FIGHTER_COOLDOWN} }"]
    ] },
    'js/server/sim-node.js': { marker: 'physics/statics.js', pairs: [
        ["'js/game/rules.js', 'js/game/simstate.js', 'js/game/ai.js',", "'js/physics/statics.js', 'js/physics/web.js',\n    'js/game/rules.js', 'js/game/simstate.js', 'js/game/ai.js',"]
    ] },
    'js/game/rules.js': { marker: 'clearStatics', pairs: [
        ["clearMines();", "clearMines();\n    clearStatics();"],
        ["stepSwaps(); // SWAP: casts and swaps", "stepStatics(); // STATICS: placed things (WEB lines slow whatever crosses them), after everything has moved\n    stepSwaps(); // SWAP: casts and swaps"],
        ["'split', 'fighter' ]", "'split', 'web', 'fighter' ]"]
    ] },
    'js/game/simstate.js': { marker: 'statics: statics.map', pairs: [
        ["mines: mines.map(owned),", "mines: mines.map(owned),\n        statics: statics.map(owned),\n        staticSeq,"],
        ["mineSeq = s.mineSeq || 0;", "mineSeq = s.mineSeq || 0;\n    statics.length = 0;\n    statics.push(...relink(s.statics || []));\n    staticSeq = s.staticSeq || 0;"]
    ] },
    'js/physics/player-casts.js': { marker: "id === 'web'", pairs: [
        ["} else if (id === 'warp') { // instant: no cast, no timer (see warpPress)",
         "} else if (id === 'web') { // instant: drop a node where you stand (see physics/web.js)\n            if (this.cd.web <= 0 && !this.sim) {\n                placeWebNode(this);\n                this.cd.web = WEB_COOLDOWN;\n                return true;\n            }\n            return false;\n        } else if (id === 'warp') { // instant: no cast, no timer (see warpPress)"]
    ] },
    'js/render/special-menu.js': { marker: "id: 'web'", pairs: [
        ["{ id: 'split', name: 'SPLIT', icon: 'split' },", "{ id: 'split', name: 'SPLIT', icon: 'split' },\n    { id: 'web', name: 'WEB', icon: 'web' },"],
        ["const spSz = () => (twoSpecials ? 36 : 40);", "const spSz = () => (twoSpecials ? 36 : 40);\nconst SP_ROW = 30; // height of one entry in the special dropdown (20 entries of 32 would run off the bottom of the canvas)"],
        ["+ 25 + n * 32, w: 40, h: 32 }", "+ 25 + n * SP_ROW, w: 40, h: SP_ROW }"],
        ["SPECIALS.length * 32 + 4", "SPECIALS.length * SP_ROW + 4"]
    ] },
    'js/render/key-hints.js': { marker: "kind === 'web'", pairs: [
        ["} else if (kind === 'locked') { // padlock",
         "} else if (kind === 'web') { // three nodes joined by lines\n        cx.lineWidth = 2;\n        cx.moveTo(-8, 6); cx.lineTo(0, -8); cx.lineTo(8, 6); cx.closePath(); cx.stroke();\n        for (const [nx, ny] of [[-8, 6], [0, -8], [8, 6]]) {\n            cx.beginPath(); cx.arc(nx, ny, 2.8, 0, 7); cx.fill();\n        }\n    } else if (kind === 'locked') { // padlock"]
    ] },
    'js/render/pick-screen.js': { marker: "web: ['", pairs: [
        ["split: ['Halve yourself, leave a copy.',", "web: ['Press to drop nodes. Lines link', 'every node; anything crossing a', 'line loses some speed.'],\n    split: ['Halve yourself, leave a copy.',"]
    ] },
    'js/render/render.js': { marker: 'drawWebs', pairs: [
        ["drawMines(); // planted mines", "drawWebs(); // placed web nodes and the lines between them\n    drawMines(); // planted mines"]
    ] },
    'index.html': { marker: 'physics/statics.js', pairs: [
        ['<script src="js/physics/fighter.js"></script>', '<script src="js/physics/fighter.js"></script>\n<script src="js/physics/statics.js"></script>\n<script src="js/physics/web.js"></script>'],
        ['<script src="js/render/mines.js"></script>', '<script src="js/render/mines.js"></script>\n<script src="js/render/web.js"></script>']
    ] },
    'js/server/server.js': { marker: "'split', 'web'", pairs: [
        ["'split', 'fighter', ]", "'split', 'web', 'fighter', ]"]
    ] },
    'js/test/state-test.js': { marker: "'explode', 'web'", pairs: [
        ["'awakened', 'explode'];", "'awakened', 'explode', 'web'];"]
    ] }
};

const problems = [], out = [], notes = [];
if (!fs.existsSync(path.join(root, 'index.html')))
    problems.push('run this from the project folder (the one that contains index.html)');
for (const f of NEW_FILES)
    if (!fs.existsSync(path.join(root, f)))
        problems.push(`missing ${f}: copy the new files into the project first (keep their folders)`);
if (!problems.length)
    for (const [file, spec] of Object.entries(EDITS)) {
        const p = path.join(root, file);
        if (!fs.existsSync(p)) { problems.push(`${file} not found`); continue; }
        let text = fs.readFileSync(p, 'utf8');
        if (text.includes(spec.marker)) { notes.push(`skipped ${file} (already has the change)`); continue; }
        const crlf = text.includes('\r\n'), conv = s => (crlf ? s.replace(/\r?\n/g, '\r\n') : s);
        spec.pairs.forEach(([o, n], i) => {
            const old = conv(o), count = text.split(old).length - 1;
            if (count !== 1) problems.push(`${file}: edit ${i + 1} (starts "${o.split('\n')[0].trim().slice(0, 60)}") was found ${count} times, expected once`);
            else text = text.replace(old, () => conv(n));
        });
        out.push([p, text]);
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
notes.forEach(n => console.log(n));
console.log('\nDone. Now run:  npm test');
