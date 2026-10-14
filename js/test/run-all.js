// Runs every js/test/*-test.js, one after the other, each in its own Node process, then prints a summary. Works the same in cmd, PowerShell and bash.
// Run from the project folder:  node js/test/run-all.js     (or:  npm test)
// Only run some:  node js/test/run-all.js chat predict      (any test whose file name contains one of the words)
// Exit code is 0 only if every test passed, so it can also be used in scripts.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const words = process.argv.slice(2);
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('-test.js') && (!words.length || words.some(w => f.includes(w)))).sort();
if (!files.length) {
    console.log('No tests found' + (words.length ? ' matching: ' + words.join(', ') : '') + '.');
    process.exit(1);
}
const results = [];
for (const f of files) {
    console.log('\n===== ' + f + ' =====');
    const t0 = Date.now(), r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
    results.push({ f, ok: r.status === 0, secs: ((Date.now() - t0) / 1000).toFixed(1), code: r.status === null ? 'killed (' + r.signal + ')' : r.status });
}
console.log('\n===== SUMMARY =====');
for (const r of results)
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.f.padEnd(24) + r.secs + 's' + (r.ok ? '' : '   exit code ' + r.code));
const bad = results.filter(r => !r.ok);
console.log(bad.length ? `\n${bad.length} of ${results.length} test files FAILED` : `\nall ${results.length} test files passed`);
process.exit(bad.length ? 1 : 0);
