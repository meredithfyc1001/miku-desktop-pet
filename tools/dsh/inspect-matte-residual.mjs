/** Flag large opaque areas that still resemble a red-gradient backdrop. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportFile = process.argv[2] && resolve(process.argv[2]);
const inside = p => { const r = relative(root, p); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
if (!reportFile || !inside(reportFile) || !existsSync(reportFile)) throw new Error('Usage: node tools/dsh/inspect-matte-residual.mjs <gradient-matte-report.json>');
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const source = resolve(report.source || ''), candidate = resolve(report.candidate || '');
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
if (!inside(source) || !inside(candidate) || !existsSync(source) || !existsSync(candidate) ||
    hash(source) !== report.sourceSha256 || hash(candidate) !== report.candidateSha256) throw new Error('Source or candidate does not match the matte report');
if (report.width !== 640 || report.height !== 360) throw new Error('Expected a 640×360 matte candidate');

const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const run = args => {
  const p = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', ...args], { maxBuffer: 64 * 1024 * 1024 });
  if (p.error || p.status !== 0) throw p.error || new Error(p.stderr.toString());
  return p.stdout;
};
const width = 640, height = 360, pixels = width * height, sampleRate = 4;
const rgb = run(['-i', source, '-vf', `fps=${sampleRate},scale=640:360:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const rgba = run(['-c:v', 'libvpx-vp9', '-i', candidate, '-vf', `fps=${sampleRate}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
const frames = rgb.length / (pixels * 3);
if (!Number.isSafeInteger(frames) || frames < 1 || frames !== rgba.length / (pixels * 4)) throw new Error('Sample frame counts differ');
const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const details = [];
for (let f = 0; f < frames; f++) {
  const rowR = [], rowG = [], rowB = [];
  for (let y = 0; y < height; y++) {
    const rs = [], gs = [], bs = [];
    for (let x = 2; x < 34; x += 4) for (const side of [x, width - 1 - x]) {
      const p = f * pixels * 3 + (y * width + side) * 3;
      rs.push(rgb[p]); gs.push(rgb[p + 1]); bs.push(rgb[p + 2]);
    }
    rowR[y] = median(rs); rowG[y] = median(gs); rowB[y] = median(bs);
  }
  if (![30, 180, 330].every(y => rowR[y] > rowG[y] + 35 && rowR[y] > rowB[y] + 25)) throw new Error('This diagnostic only supports a reddish backdrop');
  const mask = new Uint8Array(pixels), seen = new Uint8Array(pixels), queue = new Int32Array(pixels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = f * pixels * 3 + i * 3;
    if (rgba[f * pixels * 4 + i * 4 + 3] >= 128 && Math.hypot(rgb[p] - rowR[y], rgb[p + 1] - rowG[y], rgb[p + 2] - rowB[y]) < 20) mask[i] = 1;
  }
  let largest = 0, bounds = null;
  for (let origin = 0; origin < pixels; origin++) {
    if (!mask[origin] || seen[origin]) continue;
    let start = 0, end = 0, minX = width, minY = height, maxX = 0, maxY = 0;
    seen[origin] = 1; queue[end++] = origin;
    while (start < end) {
      const i = queue[start++], x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const add = j => { if (mask[j] && !seen[j]) { seen[j] = 1; queue[end++] = j; } };
      if (x > 0) add(i - 1); if (x < width - 1) add(i + 1);
      if (y > 0) add(i - width); if (y < height - 1) add(i + width);
    }
    if (end > largest) { largest = end; bounds = { minX, minY, maxX, maxY }; }
  }
  details.push({ timeApproxSeconds: f / sampleRate, largestNearBackdropOpaqueComponent: largest, bounds });
}
const result = {
  source, sourceSha256: report.sourceSha256, candidate, candidateSha256: report.candidateSha256,
  sampleRate, sampledFrames: frames,
  maximumNearBackdropOpaqueComponent: Math.max(...details.map(d => d.largestNearBackdropOpaqueComponent)),
  samplesWithLargeMatches: details.filter(d => d.largestNearBackdropOpaqueComponent >= 40),
  details,
  note: 'Color-only screening at sampled times, not semantic recognition or a substitute for visual review; red clothing can resemble the backdrop.'
};
writeFileSync(join(dirname(reportFile), 'matte-residual-report.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, details: undefined }));
