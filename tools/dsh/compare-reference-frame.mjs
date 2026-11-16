/** Find an approximate scale/position match against the original opaque pixels. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'assets/source-materials/approved-front.png');
const reportPath = process.argv[2] && resolve(process.argv[2]);
if (!reportPath || !existsSync(reportPath)) throw new Error('Usage: node tools/dsh/compare-reference-frame.mjs <inspection.json>');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const decode = (file, filter, pixelFormat) => {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', filter, '-pix_fmt', pixelFormat, '-f', 'rawvideo', '-'], { maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) throw r.error || new Error(r.stderr.toString());
  return r.stdout;
};
const original = decode(source, 'scale=600:720', 'rgba');
const generated = decode(report.input, 'scale=1280:720', 'rgb24');
if (original.length !== 600 * 720 * 4 || generated.length !== 1280 * 720 * 3) throw new Error('Unexpected image sizes');
const samples = [];
for (let y = 0; y < 720; y += 8) for (let x = 0; x < 600; x += 8) {
  const p = (y * 600 + x) * 4;
  if (original[p + 3] > 250) samples.push([x, y, original[p], original[p + 1], original[p + 2]]);
}
if (samples.length < 100) throw new Error('Reference has too few opaque pixels');
const score = (s, left, top) => {
  let total = 0, n = 0;
  for (const [x, y, r, g, b] of samples) {
    const xx = Math.round(left + x * s), yy = Math.round(top + y * s);
    if (xx < 0 || yy < 0 || xx >= 1280 || yy >= 720) continue;
    const p = (yy * 1280 + xx) * 3;
    total += Math.abs(generated[p] - r) + Math.abs(generated[p + 1] - g) + Math.abs(generated[p + 2] - b);
    n++;
  }
  return n < samples.length * .99 ? Infinity : total / (3 * n);
};
let best = { meanRgbError: Infinity };
const tryOne = (s, x, y) => { const e = score(s, x, y); if (e < best.meanRgbError) best = { meanRgbError: e, scale: s, left: x, top: y }; };
for (const s of [.80, .85, .90, .95, 1]) {
  const cx = (1280 - 600 * s) / 2;
  for (let y = 0; y <= 720 - 720 * s + .01; y += 8) for (let x = cx - 100; x <= cx + 100; x += 8) tryOne(s, x, y);
}
const coarse = { ...best };
for (let s = Math.max(.8, coarse.scale - .04); s <= Math.min(1, coarse.scale + .04) + .0001; s += .01)
  for (let y = Math.max(0, coarse.top - 8); y <= Math.min(720 - 720 * s, coarse.top + 8); y += 2)
    for (let x = coarse.left - 8; x <= coarse.left + 8; x += 2) tryOne(s, x, y);
const result = { input: report.input, source, sampledOpaquePixels: samples.length, approximateMatch: best, note: 'Lower RGB difference means closer under the searched scale and position. Compression, interpolation, background spill and color transforms also affect the score; visual comparison remains necessary.' };
writeFileSync(join(dirname(reportPath), 'reference-match.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
