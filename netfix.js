// testfix2.js - moves the tests from arrows / boomerangs / fireballs to the unified projectiles list.
// Run from the project root:   node testfix2.js      (all-or-nothing, writes <file>.bak first)
const fs = require('fs'), path = require('path');
const files = {}, problems = [];
const load = f => files[f] || (files[f] = (raw => ({ raw, crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') }))(fs.readFileSync(path.join(__dirname, f), 'utf8')));
function edit(f, find, rep, label) { // an exact string that must occur once
    const F = load(f), n = F.text.split(find).length - 1;
    if (n !== 1) return problems.push(`${f}: anchor found ${n} times, expected 1 (${label})`);
    F.text = F.text.replace(find, () => rep);
    console.log('  ok   ' + f + ': ' + label);
}
function sub(f, re, rep, label) { // every match of a regex (at least one)
    const F = load(f), n = (F.text.match(re) || []).length;
    if (!n) return problems.push(`${f}: pattern not found (${label})`);
    F.text = F.text.replace(re, () => rep);
    console.log(`  ok   ${f}: ${label} (${n}x)`);
}
const T = 'js/test/';
const STUB = 'decoys = [], arrows = [], boomerangs = [];';
const STUB_NEW = `decoys = [], projectiles = [], PROJ_TYPES = { arrow: { swappable: true }, boomerang: { swappable: true } }, arrow0 = () => projectiles.find(p => p.type === 'arrow'), boom0 = () => projectiles.find(p => p.type === 'boomerang');`;

// arrow-impulse-test
sub(T + 'arrow-impulse-test.js', /arrows\.push\(\{ x:/g, 'projectiles.push({ type: \'arrow\', pLock: 0, x:', 'addArrow pushes a typed projectile');
sub(T + 'arrow-impulse-test.js', /arrows\[0\]/g, 'projOf("arrow")[0]', 'arrows[0] -> projOf');

// dual-test
sub(T + 'dual-test.js', /arrows\.length/g, 'projOf("arrow").length', 'arrows.length -> projOf');

// fighter-test
edit(T + 'fighter-test.js', "sim.run('fireballs.length = 0')", "sim.run('projectiles.length = 0')", 'clearing fireballs');
sub(T + 'fighter-test.js', /fireballs\.length/g, 'projOf("fireball").length', 'fireballs.length -> projOf');
sub(T + 'fighter-test.js', /fireballs\[0\]/g, 'projOf("fireball")[0]', 'fireballs[0] -> projOf');

// swap-test and portal-test: the stub world
for (const f of ['swap-test.js', 'portal-test.js'])
    edit(T + f, STUB, STUB_NEW, 'stub world has projectiles');
edit(T + 'swap-test.js', 'decoys.length = 0; arrows.length = 0; boomerangs.length = 0;', 'decoys.length = 0; projectiles.length = 0;', 'reset() clears projectiles');
edit(T + 'swap-test.js', "run('arrows.length = 0');", "run('for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].type === \"arrow\") projectiles.splice(i, 1)');", 'remove only the arrows');
sub(T + 'swap-test.js', /arrows\.push\(\{/g, 'projectiles.push({ type: "arrow",', 'arrow pushes');
sub(T + 'swap-test.js', /boomerangs\.push\(\{/g, 'projectiles.push({ type: "boomerang",', 'boomerang pushes');
sub(T + 'swap-test.js', /arrows\[0\]/g, 'arrow0()', 'arrows[0]');
sub(T + 'swap-test.js', /boomerangs\[0\]/g, 'boom0()', 'boomerangs[0]');

// predict-test: the "what is drawn from which timeline" block
const PT = T + 'predict-test.js';
edit(PT, 'pred.state.arrows = [{ owner: 0, x: 1 }]; pred.state.pegs = [{ owner: 0, x: 11 }];', "pred.state.projectiles = [{ type: 'arrow', owner: 0, x: 1 }]; pred.state.pegs = [{ owner: 0, x: 11 }];", 'predicted world: my arrow');
edit(PT, 'mixed.arrows = [{ owner: 0, x: 2 }, { owner: 1, x: 3 }];', "mixed.projectiles = [{ type: 'arrow', owner: 0, x: 2 }, { type: 'arrow', owner: 1, x: 3 }];", 'drawn world: both arrows');
edit(PT, 'pred.state.arrows = [{ owner: 0, x: 1 }, { owner: 1, x: 4 }];', "pred.state.projectiles = [{ type: 'arrow', owner: 0, x: 1 }, { type: 'arrow', owner: 1, x: 4 }];", 'predicted world: both arrows');
sub(PT, /mixed\.arrows/g, 'mixed.projectiles', 'mixed.arrows');
sub(PT, /out\.arrows/g, 'out.projectiles', 'out.arrows');
sub(PT, /shots\.arrows/g, 'shots.projectiles', 'shots.arrows');

if (problems.length) { console.error('\nNothing was changed. Problems:\n  ' + problems.join('\n  ')); process.exit(1); }
for (const f in files) { const F = files[f]; fs.writeFileSync(path.join(__dirname, f + '.bak'), F.raw); fs.writeFileSync(path.join(__dirname, f), F.crlf ? F.text.replace(/\n/g, '\r\n') : F.text); }
console.log('\nDone: ' + Object.keys(files).length + ' test files fixed (.bak copies kept). Now run:  npm test');