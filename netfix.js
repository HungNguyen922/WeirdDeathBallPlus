// testfix.js - repairs the netcode tests that stopped testing what they claim to (stale scenarios + two timing races).
// Run from the project root:   node testfix.js      (all-or-nothing, writes <file>.bak first)
const fs = require('fs'), path = require('path');
const files = {}, problems = [];
const load = f => files[f] || (files[f] = (raw => ({ raw, crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') }))(fs.readFileSync(path.join(__dirname, f), 'utf8')));
function edit(f, find, rep, label) {
    const F = load(f), n = F.text.split(find).length - 1;
    if (n !== 1) return problems.push(`${f}: anchor found ${n} times, expected 1 (${label})`);
    F.text = F.text.replace(find, () => rep);
    console.log('  ok   ' + f + ': ' + label);
}
const P = 'js/test/predict-test.js', C = 'js/test/client-test.js';

// With START_CD = 1 every special starts a round on its full cooldown, so a scripted press in the first seconds does nothing. The decoy scenarios press at tick 10.
edit(P, "for (const sim of [S, C]) { sim.run('setTeamSize(1)'); sim.run(`players[0].special = '${special}'; players[1].special = 'decoy'`); }",
"for (const sim of [S, C]) { sim.run('setTeamSize(1)'); sim.run(`players[0].special = '${special}'; players[1].special = 'decoy'`); sim.run('for (const p of players) for (const k in p.cd) p.cd[k] = 0'); } // (specials start on full cooldown now, START_CD = 1: clear it so the scripted cast at tick 10 happens)",
'decoy scenarios: clear the opening cooldown');

// The ridge at the net slopes away on both sides and the floor is slippery (GROUND_BRAKE 2), so a player standing at NETX-60 slid 30 u down to the flat and ended 91 u from the ball: out of the bat's 64 u reach, 0 hits.
edit(P, "S.run('players[0].x = players[0].sx = NETX - 60'); // standing beside the ball, so swings connect",
"S.run('players[0].x = players[0].sx = NETX - 50'); // standing beside the ball, so swings connect (the loop below steers to stay on the ridge: it slopes away and is slippery)", 'bat scenario: start on the ridge');
edit(P, "        if (r() < 0.03) nb ^= NET_BITS.sp; // only swing: stand still beside the ball",
"        if (r() < 0.03) nb ^= NET_BITS.sp; // swing\n        { const px = S.run('players[0].x'); nb = (nb & ~(NET_BITS.l | NET_BITS.r)) | (px > 436 ? NET_BITS.l : 0) | (px < 428 ? NET_BITS.r : 0); } // hold position 52-60 u from the ball (inside the bat's reach, outside touching distance)",
'bat scenario: keep the player on the ridge');
edit(P, "for (let n = 1; n <= 3000; n++) {\n        let nb = bits;\n        if (r() < 0.03)", "for (let n = 1; n <= 4000; n++) {\n        let nb = bits;\n        if (r() < 0.03)", 'bat scenario: a little longer');

// client-test: the buffer's minimum is 70 ms and the newest snapshot is on average half a snapshot interval (17 ms) older than 'now', so the measured lag sits at ~55-66 ms: > 60 was a coin flip.
edit(C, "avgLagMs > 60 && avgLagMs < 200", "avgLagMs > 40 && avgLagMs < 200", 'interpolation lag bound');
// and the score only reaches the drawn state one interpolation delay after the point event: wait for it instead of reading it the moment the event arrives.
edit(C, "    const sc = B.sim.run('score');", "    { const until = performance.now() + 2000; while (performance.now() < until && B.sim.run('score[0] + score[1]') < 1) await sleep(25); }\n    const sc = B.sim.run('score');", 'wait for the score to be drawn');

if (problems.length) { console.error('\nNothing was changed. Problems:\n  ' + problems.join('\n  ')); process.exit(1); }
for (const f in files) { const F = files[f]; fs.writeFileSync(path.join(__dirname, f + '.bak'), F.raw); fs.writeFileSync(path.join(__dirname, f), F.crlf ? F.text.replace(/\n/g, '\r\n') : F.text); }
console.log('\nDone: ' + Object.keys(files).length + ' test files fixed (.bak copies kept). Now run:  npm test');