// Headless tests for saveState / loadState and for sim determinism. Run:  node test/state-test.js
// 1. save -> load -> save gives the identical state (and survives a JSON round trip, as it would over the network).
// 2. REPLAY: from a saved state, the same inputs must produce bit-identical state, tick for tick. This is the property rollback netcode stands on.
const { loadSim } = require('../server/sim-node.js');

const SPECIALS = ['dash', 'plinko', 'marionette', 'decoy', 'arrow', 'bat', 'warp', 'awakened'];
const KEYS = ['l', 'r', 'up', 'dn', 'z', 'x', 'sp'];
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// Pre-generated inputs: inputs[tick][player] = { l, r, ... }. Keys flip rarely so holds are long (charging, gliding, tethers all get exercised).
function makeInputs(seed, ticks, nPlayers) {
    const r = rng(seed), cur = Array.from({ length: nPlayers }, () => Object.fromEntries(KEYS.map(k => [k, false]))), out = [];
    for (let t = 0; t < ticks; t++) {
        for (const c of cur)
            for (const k of KEYS)
                if (r() < (k === 'sp' ? 0.012 : k === 'z' ? 0.03 : 0.02))
                    c[k] = !c[k];
        out.push(cur.map(c => ({ ...c })));
    }
    return out;
}

function setup(sim, teamSize, seed) {
    sim.run(`Math.random = (() => { let s = ${seed}; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; })();`);
    sim.run(`setTeamSize(${teamSize})`);
    sim.run('resetMatch()');
    const r = rng(seed ^ 0x9e3779b9);
    sim.run('players').forEach((_, i) => sim.run(`players[${i}].special = '${SPECIALS[Math.floor(r() * SPECIALS.length)]}'`));
}

function feed(sim, inputs, t) {
    const n = sim.run('players.length');
    for (let i = 0; i < n; i++)
        sim.ctx.__k = inputs[t][i], sim.run(`Object.assign(players[${i}].keys, __k)`);
}

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL: ' + msg); } };

let cover = { decoys: 0, pegs: 0, arrows: 0, ropes: 0, ballRopes: 0, casts: new Set(), bathits: 0, points: 0 };
const configs = [];
for (let seed = 1; seed <= 12; seed++)
    configs.push({ seed, teamSize: seed % 3 === 0 ? 2 : 1 });

for (const { seed, teamSize } of configs) {
    const TICKS = 2400, SAVE_AT = 700, nP = teamSize * 2;
    const inputs = makeInputs(seed * 7919, TICKS, nP);
    const sim = loadSim();
    setup(sim, teamSize, seed);
    const hashes = [];
    let saved = null, rngAtSave = null;
    for (let t = 0; t < TICKS; t++) {
        if (t === SAVE_AT) {
            saved = sim.save();
            check(sim.hash() === sim.run('stateHash(saveState())'), `seed ${seed}: hash differs between two saves of the same state`);
        }
        feed(sim, inputs, t);
        sim.tick();
        if (t >= SAVE_AT && t % 40 === 0) hashes.push(sim.hash());
        cover.decoys = Math.max(cover.decoys, sim.run('decoys.length'));
        cover.pegs = Math.max(cover.pegs, sim.run('pegs.length'));
        cover.arrows = Math.max(cover.arrows, sim.run('arrows.length'));
        cover.ropes += sim.run('players.filter(p => p.rope).length') > 0 ? 1 : 0;
        cover.ballRopes += sim.run('players.filter(p => p.rope && p.onBall).length') > 0 ? 1 : 0;
        for (const ty of sim.run('players.map(p => p.cast ? p.cast.type : null)')) if (ty) cover.casts.add(ty);
    }
    // 1. round trips
    const finalHash = sim.hash();
    const s1 = saved;
    sim.load(JSON.parse(JSON.stringify(s1)));
    check(sim.hash() === sim.run('stateHash(' + 'saveState())') , `seed ${seed}: load() then save() hash unstable`);
    sim.load(s1);
    const afterLoad = sim.save();
    check(JSON.stringify(afterLoad) === JSON.stringify(s1), `seed ${seed}: save(load(s)) != s`);
    // 2. replay from the saved state with the same inputs
    sim.load(JSON.parse(JSON.stringify(s1))); // via JSON, like a snapshot arriving over the wire
    sim.run(`Math.random = Math.random`); // (the AI is off in this test, so the random stream is not consumed)
    const replay = [];
    for (let t = SAVE_AT; t < TICKS; t++) {
        feed(sim, inputs, t);
        sim.tick();
        if (t % 40 === 0) replay.push(sim.hash());
    }
    const ok = replay.length === hashes.length && replay.every((h, i) => h === hashes[i]);
    check(ok, `seed ${seed}: replay diverged (first bad checkpoint ${replay.findIndex((h, i) => h !== hashes[i])})`);
    check(sim.hash() === finalHash, `seed ${seed}: final state differs after replay`);
    console.log(`seed ${String(seed).padStart(2)} ${teamSize}v${teamSize}: ${ok && sim.hash() === finalHash ? 'ok  ' : 'FAIL'} (${hashes.length} checkpoints, final ${finalHash}, score ${JSON.stringify(sim.run('score'))})`);
}
console.log('coverage: max decoys', cover.decoys, '| max pegs', cover.pegs, '| max arrows', cover.arrows, '| ticks with a rope', cover.ropes, '| ticks tethered to a ball', cover.ballRopes, '| casts seen', [...cover.casts].join(','));
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall good');
process.exit(fails ? 1 : 0);
