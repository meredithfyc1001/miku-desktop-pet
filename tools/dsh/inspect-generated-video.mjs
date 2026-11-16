/** Inspect a downloaded sample without changing the active pet pack. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const input = process.argv[2] && resolve(process.argv[2]);
const action = process.argv[3] || 'idle';
const actions = ['idle', 'wave', 'walk', 'hat', 'gaze', 'shy', 'nod', 'flow-nod', 'flow-step', 'flow-idle',
  'flow-wave', 'flow-pat', 'flow-sleep', 'flow-wake', 'flow-lift', 'flow-land', 'flow-salute', 'flow-dance',
  'flow-sway', 'flow-dream', 'flow-walk', 'flow-hang', 'flow-hat', 'flow-gaze', 'flow-shy', 'flow-step-short',
  'flow-fan', 'flow-tanghulu', 'flow-flower', 'flow-hum', 'flow-cube', 'flow-mirror', 'flow-stretch',
  'flow-yawn', 'flow-balloon', 'flow-bell', 'flow-startle', 'flow-finger-heart', 'flow-quota-full',
  'flow-quota-full-five', 'flow-quota-normal', 'flow-quota-low', 'flow-quota-empty',
  'flow-tea', 'flow-book', 'flow-onigiri', 'flow-microphone', 'flow-magnifier', 'flow-cookie', 'flow-maraca',
  'flow-thanks', 'flow-pout', 'flow-ear-cup', 'flow-umbrella-peek', 'flow-paper-crane', 'flow-pocket-watch',
  'flow-lantern', 'flow-map', 'flow-wind-chime', 'flow-flower-card', 'flow-head-shake', 'flow-shush',
  'flow-thumbs-up', 'flow-victory-sign', 'flow-wrist-stretch', 'flow-lean-in', 'flow-shrug', 'flow-smooth-skirt',
  'flow-think', 'flow-pocket-notebook', 'flow-music-box', 'flow-tea-tin', 'flow-ribbon-spool'];
if (!input || !existsSync(input) || !actions.includes(action)) {
  throw new Error(`Usage: node tools/dsh/inspect-generated-video.mjs <downloaded-video> [${actions.join('|')}]`);
}
const base = process.argv[4] ? resolve(process.argv[4]) : join(root, 'assets/video-production');
const baseRel = relative(root, base);
if (isAbsolute(baseRel) || baseRel === '..' || baseRel.startsWith('..' + sep)) throw new Error('Output must stay inside this project');
const folder = join(base, action);
const rel = relative(base, folder);
if (rel.startsWith('..' + sep) || rel === '..') throw new Error('Invalid output folder');
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const run = args => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], { maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result;
};
// Full decode catches damaged/truncated downloads, not just a valid first frame.
const decoded = run(['-v', 'info', '-i', input, '-map', '0:v:0', '-an', '-f', 'null', '-']);
const info = decoded.stderr.toString();
const sample = run(['-v', 'error', '-i', input, '-an', '-vf', 'fps=2,scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout;
const width = 320, height = 180, bytes = width * height * 3;
const count = Math.floor(sample.length / bytes);
if (!count || sample.length % bytes) throw new Error('No complete sampled frames');
const isKey = (r, g, b) => r > 180 && b > 180 && g < 85 && Math.abs(r - b) < 65;
const frames = [];
for (let f = 0; f < count; f++) {
  let border = 0, keyed = 0, foreground = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  let warmUpperLeft = 0, warmUpperRight = 0;
  const offset = f * bytes;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = offset + (y * width + x) * 3;
    const r=sample[p], g=sample[p+1], b=sample[p+2];
    const key = isKey(sample[p], sample[p + 1], sample[p + 2]);
    // A tentative umbrella-position cue for this reddish-background reference.
    // This is not semantic recognition: flowers, skin and lighting can affect it.
    const warm = r>115 && g>80 && b>40 && r>g+3 && g>b+8 && r-b>25 && r-g<100;
    if(y<85 && x<150 && warm)warmUpperLeft++;
    if(y<85 && x>170 && warm)warmUpperRight++;
    if (x < 16 || x >= width - 16 || y < 9 || y >= height - 9) { border++; if (key) keyed++; }
    if (!key) { foreground++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  const warmSideCue = warmUpperLeft >= 250 && warmUpperLeft > 2 * warmUpperRight ? 'left' :
    warmUpperRight >= 250 && warmUpperRight > 2 * warmUpperLeft ? 'right' : 'uncertain';
  frames.push({ timeApproxSeconds: f / 2, magentaBorderFraction: keyed / border, nonKeyFraction: foreground / (width * height), nonKeyBounds: maxX < 0 ? null : { minX, minY, maxX, maxY }, warmUpperLeft, warmUpperRight, warmSideCue });
}
let loopDelta = 0, motionDelta = 0, foregroundDelta = 0, foregroundPixels = 0;
for (let p = 0; p < bytes; p++) loopDelta += Math.abs(sample[p] - sample[(count - 1) * bytes + p]);
// Whole-frame averages can hide a visible seam behind a mostly static background.
// Report a foreground-only measurement only when both border samples really are magenta.
const keyUsable = frames[0].magentaBorderFraction >= .95 && frames[count - 1].magentaBorderFraction >= .95;
if (keyUsable) for (let p = 0; p < bytes; p += 3) {
  const last = (count - 1) * bytes + p;
  if (!isKey(sample[p], sample[p + 1], sample[p + 2]) || !isKey(sample[last], sample[last + 1], sample[last + 2])) {
    foregroundPixels++;
    for (let c = 0; c < 3; c++) foregroundDelta += Math.abs(sample[p + c] - sample[last + c]);
  }
}
for (let f = 1; f < count; f++) for (let p = 0; p < bytes; p++) motionDelta += Math.abs(sample[f * bytes + p] - sample[(f - 1) * bytes + p]);
mkdirSync(folder, { recursive: true });
// Spread the ten thumbnails across the whole clip. Sampling at a fixed 1 fps
// silently omitted the second half when a generator returned a 20-second clip.
const contactFps = Math.min(2, 20 / count);
run(['-v', 'error', '-y', '-i', input, '-an', '-vf', `fps=${contactFps},scale=320:180,tile=5x2:padding=6:margin=6:color=white`, '-frames:v', '1', join(folder, 'contact-sheet.png')]);
run(['-v', 'error', '-y', '-i', input, '-frames:v', '1', join(folder, 'first-frame.png')]);
run(['-v', 'error', '-y', '-sseof', '-0.1', '-i', input, '-frames:v', '1', join(folder, 'last-frame.png')]);
const report = {
  input, inputSha256: createHash('sha256').update(readFileSync(input)).digest('hex').toUpperCase(), action, decodedCompletely: true, ffmpegInfo: info,
  sampleRate: 2, sampleWidth: width, sampleHeight: height, sampledFrames: count, contactSheetFps: contactFps,
  firstLastSampleMeanRgbDelta: loopDelta / bytes,
  firstLastSampleForegroundMeanRgbDelta: keyUsable && foregroundPixels ? foregroundDelta / (foregroundPixels * 3) : null,
  adjacentSampleMeanRgbDelta: count > 1 ? motionDelta / ((count - 1) * bytes) : 0,
  warmSideCueCounts: Object.fromEntries(['left','right','uncertain'].map(side=>[side,frames.filter(frame=>frame.warmSideCue===side).length])),
  frames,
  acceptance: 'Visual review still required. Warm-color counts are only cues for this red backdrop, not recognition of the umbrella. Measurements do not prove identity, clean matting, seamless loops, or a real generation frame rate. No active media was replaced.'
};
writeFileSync(join(folder, 'inspection.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: folder, decodedCompletely: true, sampledFrames: count, firstLastSampleMeanRgbDelta: report.firstLastSampleMeanRgbDelta, magentaBorderMin: Math.min(...frames.map(f => f.magentaBorderFraction)) }));
