// Copies only what the browser needs into dist/ (no server code, tests, or tooling)
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const skip = rel => /(^|[\\/])(server|test)([\\/]|$)/.test(rel) || /\.(py|mid|bak|old)$/.test(rel);
for (const item of ['index.html', 'icon.png', 'css', 'js']) {
    const src = path.join(__dirname, item);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(OUT, item), { recursive: true, filter: s => !skip(path.relative(__dirname, s)) });
}
console.log('static site written to dist/');