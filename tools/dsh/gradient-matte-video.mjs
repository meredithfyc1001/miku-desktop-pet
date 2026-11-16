/** Experimental border-connected matte for a red gradient video; creates a candidate only. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { recoverEnclosedBackground } from './recover-enclosed-background.mjs';
import { pinkFloorOpacity } from './pink-floor-shadow.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportFile = process.argv[2] && resolve(process.argv[2]);
const recoverSmallMagenta = process.argv.slice(3).includes('--recover-small-magenta');
const recoverEnclosed = process.argv.slice(3).includes('--recover-enclosed') || recoverSmallMagenta;
const removePinkFloor = process.argv.slice(3).includes('--pink-floor');
if (process.argv.slice(3).some(arg => !['--recover-enclosed', '--recover-small-magenta', '--pink-floor'].includes(arg))) throw new Error('Unknown matte option');
const inside = p => { const r = relative(root, p); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
if (!reportFile || !inside(reportFile) || !existsSync(reportFile)) throw new Error('Usage: node tools/dsh/gradient-matte-video.mjs <local inspection.json>');
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const input = resolve(report.input || '');
if (!inside(input) || !existsSync(input)) throw new Error('Sample input is missing or outside the project');
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
if (!report.inputSha256 || hash(input) !== report.inputSha256) throw new Error('Source changed; inspect it again');
const dimensions = report.ffmpegInfo.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
const rate = Number(report.ffmpegInfo.match(/Video:[^\n]*?\b(\d+(?:\.\d+)?) fps\b/)?.[1]);
const expected = Number([...report.ffmpegInfo.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
if (!report.decodedCompletely || !dimensions || Math.abs(+dimensions[1] / +dimensions[2] - 16 / 9) > .005 || !rate || !expected) throw new Error('Expected a completely decoded 16:9 video with an identifiable frame rate');
const folder = dirname(reportFile), target = join(folder, 'gradient-candidate.webm');
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const width = 640, height = 360, pixels = width * height, inputBytes = pixels * 3;
const decoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', input, '-map', '0:v:0', '-an', '-vf', 'scale=640:360:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
// Keep any nonvisual source provenance while processing only the video stream.
const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '640x360', '-r', String(rate), '-i', '-', '-i', input, '-map', '0:v:0', '-map_metadata', '1', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-lossless', '1', '-auto-alt-ref', '0', '-row-mt', '1', '-threads', '4', '-deadline', 'good', '-cpu-used', '4', target]);
let decoderError = '', encoderError = '';
decoder.stderr.on('data', x => { decoderError += x.toString(); });
encoder.stderr.on('data', x => { encoderError += x.toString(); });
const finished = p => new Promise((ok, fail) => { p.once('error', fail); p.once('close', code => code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`))); });
const decodeDone = finished(decoder), encodeDone = finished(encoder);
// Attach rejection handlers immediately so a process failure cannot be lost while streaming.
decodeDone.catch(() => {}); encodeDone.catch(() => {});
const candidates = new Uint8Array(pixels), reached = new Uint8Array(pixels), queue = new Int32Array(pixels);
const rowR = new Float32Array(height), rowG = new Float32Array(height), rowB = new Float32Array(height);
const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
// The lower strip contains the model-generated red floor shadow. Restrict the
// wider removal to reddish pixels so pale legs and dark shoes remain protected.
const floorShadow = (y, r, g, b) => y >= 320 && r > 1.6 * (g + 5) && r > 1.45 * (b + 5);
const matte = rgb => {
  for (let y = 0; y < height; y++) {
    const rs = [], gs = [], bs = [];
    for (let x = 2; x < 34; x += 4) for (const side of [x, width - 1 - x]) {
      const p = (y * width + side) * 3; rs.push(rgb[p]); gs.push(rgb[p + 1]); bs.push(rgb[p + 2]);
    }
    rowR[y] = median(rs); rowG[y] = median(gs); rowB[y] = median(bs);
  }
  // This method is deliberately restricted to the reddish studio backdrop of this sample.
  if (![30, 180, 330].every(y => rowR[y] > rowG[y] + 35 && rowR[y] > rowB[y] + 25)) throw new Error('Unexpected border color; do not apply a red gradient matte');
  if (removePinkFloor && ![315, 340].every(y => rowR[y] > rowG[y] + 80 && rowB[y] > rowG[y] + 35)) throw new Error('Unexpected border color; do not apply the pink floor treatment');
  candidates.fill(0); reached.fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = i * 3;
    const dr = rgb[p] - rowR[y], dg = rgb[p + 1] - rowG[y], db = rgb[p + 2] - rowB[y];
    const radius = floorShadow(y, rgb[p], rgb[p + 1], rgb[p + 2]) ? 125 : 58;
    if (dr * dr + dg * dg + db * db <= radius * radius) candidates[i] = 1;
  }
  let start = 0, end = 0;
  const add = i => { if (candidates[i] && !reached[i]) { reached[i] = 1; queue[end++] = i; } };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { add(y * width); add(y * width + width - 1); }
  while (start < end) {
    const i = queue[start++], x = i % width;
    if (x > 0) add(i - 1); if (x < width - 1) add(i + 1);
    if (i >= width) add(i - width); if (i < pixels - width) add(i + width);
  }
  if (recoverEnclosed) {
    const recovered = recoverEnclosedBackground({ rgb, width, height, candidates, reached, rowR, rowG, rowB, recoverSmallMagenta });
    recoveredPixels += recovered.recoveredPixels;
    if (recovered.recoveredComponents) framesWithRecoveredHoles++;
  }
  const rgba = Buffer.allocUnsafe(pixels * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = i * 3, q = i * 4;
    const dr = rgb[p] - rowR[y], dg = rgb[p + 1] - rowG[y], db = rgb[p + 2] - rowB[y];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    let a = 1;
    if (reached[i]) {
      const shadow = floorShadow(y, rgb[p], rgb[p + 1], rgb[p + 2]);
      const inner = shadow ? 90 : 15, outer = shadow ? 125 : 58;
      a = Math.max(0, Math.min(1, (distance - inner) / (outer - inner)));
    } else {
      const nextToBackground = (x > 0 && reached[i - 1]) || (x < width - 1 && reached[i + 1]) || (y > 0 && reached[i - width]) || (y < height - 1 && reached[i + width]);
      // Feather only reddish edge pixels; preserve interior reds and blue hair.
      if (nextToBackground && rgb[p] > rgb[p + 1] + 8 && rgb[p] > rgb[p + 2] + 5 && distance < 135) a = Math.max(.5, Math.min(1, (distance - 15) / 120));
    }
    if (removePinkFloor && a > 0 && y >= height * 0.68 && x >= width * 0.25 && x < width * 0.75) {
      const opacity = pinkFloorOpacity({ x, y, width, height, r: rgb[p], g: rgb[p + 1], b: rgb[p + 2], backgroundR: rowR[y], backgroundG: rowG[y], backgroundB: rowB[y] });
      if (opacity < 1) { a *= opacity; pinkFloorPixels++; }
    }
    rgba[q + 3] = Math.round(a * 255);
    // Undo the red backdrop contribution along feathered edges.
    for (let c = 0; c < 3; c++) {
      const bg = c === 0 ? rowR[y] : c === 1 ? rowG[y] : rowB[y];
      rgba[q + c] = a > .01 ? Math.max(0, Math.min(255, Math.round((rgb[p + c] - bg * (1 - a)) / a))) : 0;
    }
  }
  return rgba;
};
let pending = Buffer.alloc(0), frameCount = 0;
let recoveredPixels = 0, framesWithRecoveredHoles = 0, pinkFloorPixels = 0;
try {
  for await (const chunk of decoder.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= inputBytes) {
      const frame = pending.subarray(0, inputBytes); pending = pending.subarray(inputBytes);
      if (!encoder.stdin.write(matte(frame))) await once(encoder.stdin, 'drain');
      frameCount++;
    }
  }
  if (pending.length) throw new Error('Video decoder produced an incomplete frame');
  await decodeDone; encoder.stdin.end(); await encodeDone;
  if (frameCount !== expected) throw new Error(`Input frame count ${frameCount} differs from the decoded report ${expected}`);
  const extract = spawnSync(ffmpeg, ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', target, '-frames:v', '1', join(folder, 'gradient-first.png')]);
  if (extract.status !== 0) throw new Error(extract.stderr.toString());
  const decoded = spawnSync(ffmpeg, ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', target, '-f', 'null', '-', '-progress', 'pipe:1'], { encoding: 'utf8' });
  if (decoded.status !== 0) throw new Error(decoded.stderr);
  const outputFrames = Number([...decoded.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
  if (outputFrames !== expected) throw new Error(`Output frame count ${outputFrames} differs from source ${expected}`);
  const data = { source: input, sourceSha256: report.inputSha256, candidate: target, candidateSha256: hash(target), width, height, fps: rate, sourceFrames: expected, outputFrames, bytes: statSync(target).size, recoverEnclosed, recoverSmallMagenta, recoveredPixels, framesWithRecoveredHoles, removePinkFloor, pinkFloorPixels, note: 'Experimental gradient candidate only; inspect moving edges, enclosed holes, floor, logo and loop visually before use.' };
  writeFileSync(join(folder, 'gradient-matte-report.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(data));
} catch (e) {
  decoder.kill(); encoder.stdin.destroy(); encoder.kill();
  throw new Error(`${e.message}\n${decoderError}${encoderError}`);
}
