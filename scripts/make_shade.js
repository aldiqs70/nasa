// Shaded-relief image of the south pole (+-160 km, 200 m/pixel) from the LOLA grids -> raw float32 heights
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { Terrain } = require(path.join(ROOT, 'js/terrain.js'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/terrain/terrain.json')));
const T = new Terrain(meta, meta.levels.map((L) => { const b = fs.readFileSync(path.join(ROOT, 'data/terrain', L.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }));
const HALF = 160000, RES = 200, N = 2 * HALF / RES, h = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) h[r * N + c] = T.heightXY(-HALF + (c + 0.5) * RES, HALF - (r + 0.5) * RES);
fs.writeFileSync(process.argv[2], Buffer.from(h.buffer));
console.log(N);
