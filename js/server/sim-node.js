// Loads the game's simulation files (no renderer, no audio, no DOM) into an isolated Node context and exposes it.
// The game's files are plain browser <script>s that share top-level const/let, so they are run in ONE vm context in index.html's order.
// Usage:  const sim = loadSim();   sim.run('update()');   sim.eval('players[0].x')
const fs = require('fs'), path = require('path'), vm = require('vm');

// The project root is the nearest folder above this file that holds js/physics/constants.js, so this file works wherever it is put (server/, js/server/, ...).
function findRoot() {
    for (let dir = __dirname; ; dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'js', 'physics', 'constants.js')))
            return dir;
        if (path.dirname(dir) === dir)
            throw new Error('sim-node.js: could not find js/physics/constants.js in any folder above ' + __dirname);
    }
}
const ROOT = findRoot();
const SIM_FILES = [ // same order as index.html's <script> tags, minus everything that draws, plays sound or reads the keyboard
    'js/physics/constants.js', 'js/physics/terrain.js', 'js/physics/collision.js', 'js/physics/ball.js', 'js/physics/player.js',
    'js/physics/bodies.js', 'js/physics/arrows.js', 'js/game/rules.js', 'js/game/simstate.js', 'js/game/ai.js',
];

function loadSim() {
    const ctx = vm.createContext({ console });
    for (const f of SIM_FILES)
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    const run = code => vm.runInContext(code, ctx);
    return {
        ctx,
        run,
        eval: run,
        tick: () => run('update()'),
        save: () => run('saveState()'),
        load: s => { ctx.__s = s; run('loadState(__s)'); delete ctx.__s; },
        hash: () => run('stateHash()'),
    };
}

module.exports = { loadSim, SIM_FILES, ROOT };
