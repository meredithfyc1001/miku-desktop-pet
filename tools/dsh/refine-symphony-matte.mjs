/** Refine the edge of a 640×360 Symphony animation whose background is already keyed. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeMusicBox, prepareMusicBox, removeSmallPlatform } from './symphony-music-box.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
const [sourcePath, outputPath, frameCount, option, referencePath, ...extra] = process.argv.slice(2);
if (!sourcePath || !outputPath || !/^[1-9]\d*$/.test(frameCount) ||
    (option && (!['--music-box', '--loop-anchor'].includes(option) || !referencePath)) || extra.length) {
  throw new Error('Usage: node tools/dsh/refine-symphony-matte.mjs <source.webm> <candidate.webm> <frames> [--music-box <plate.png> | --loop-anchor <idle.webm>]');
}
const source = resolve(sourcePath);
const candidate = resolve(outputPath);
const reference = referencePath ? resolve(referencePath) : null;
const box = option === '--music-box' ? prepareMusicBox(ffmpeg, reference) : null;
const width = 640, height = 360, pixels = width * height, fps = 24;
const frameBytes = pixels * 4;
const anchor = option === '--loop-anchor' ? execFileSync(ffmpeg, [
  '-v', 'error', '-c:v', 'libvpx-vp9', '-i', reference, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-',
], { maxBuffer: frameBytes * 2 }) : null;
if (anchor && anchor.length !== frameBytes) throw new Error('Expected a 640×360 loop anchor');
const alpha = new Uint8Array(pixels);
const seen = new Uint8Array(pixels);
const component = new Int32Array(pixels);
const neighbors = [];
for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
  const distance = x * x + y * y;
  if (distance > 0 && distance <= 10) neighbors.push([y * width + x, 1 / distance]);
}

function despeckle() {
  seen.fill(0);
  for (let i = 0; i < pixels; i++) {
    if (seen[i] || alpha[i] < 16) continue;
    let head = 0, tail = 0;
    const add = p => {
      if (alpha[p] < 16 || seen[p]) return;
      seen[p] = 1;
      component[tail++] = p;
    };
    add(i);
    while (head < tail) {
      const p = component[head++];
      const x = p % width;
      if (x > 0) add(p - 1);
      if (x < width - 1) add(p + 1);
      if (p >= width) add(p - width);
      if (p < pixels - width) add(p + width);
    }
    if (tail < 18) for (let j = 0; j < tail; j++) alpha[component[j]] = 0;
  }
}

function refine(frame) {
  for (let i = 0; i < pixels; i++) alpha[i] = frame[i * 4 + 3];
  despeckle();
  const output = Buffer.alloc(frameBytes);
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const i = y * width + x, p = i * 4;
      const a = alpha[i];
      if (a < 16) continue;
      const cross = alpha[i - width] + alpha[i + width] + alpha[i - 1] + alpha[i + 1];
      const corners = alpha[i - width - 1] + alpha[i - width + 1] + alpha[i + width - 1] + alpha[i + width + 1];
      const blur = (4 * a + 2 * cross + corners) / 16;
      // Move the fringe inward by a fraction of a pixel and keep an antialiased edge.
      const coverage = Math.max(0, Math.min(255, ((a + 3 * blur) / 4 - 74) * 255 / 166));
      if (coverage < 2) continue;
      output[p + 3] = coverage;
      const edge = Math.min(1, (255 - blur) / 102);
      if (edge < .045) {
        frame.copy(output, p, p, p + 3);
        continue;
      }
      let w = 0, r = 0, g = 0, b = 0;
      for (const [offset, proximity] of neighbors) {
        const j = i + offset;
        const inner = Math.min(alpha[j], alpha[j - 1], alpha[j + 1], alpha[j - width], alpha[j + width]);
        if (!(inner >= 215)) continue;
        w += proximity;
        r += proximity * frame[j * 4];
        g += proximity * frame[j * 4 + 1];
        b += proximity * frame[j * 4 + 2];
      }
      const spill = Math.max(0, Math.min(frame[p], frame[p + 2]) - frame[p + 1] - 7);
      const amount = w ? Math.min(.92, .15 + .86 * edge + spill / 100) : 0;
      output[p] = (1 - amount) * (frame[p] - .85 * spill * edge) + (w ? amount * r / w : 0);
      output[p + 1] = (1 - amount) * (frame[p + 1] + .16 * spill * edge) + (w ? amount * g / w : 0);
      output[p + 2] = (1 - amount) * (frame[p + 2] - .75 * spill * edge) + (w ? amount * b / w : 0);
    }
  }
  return output;
}

function alignLoop(frame, index) {
  const edgeTime = Math.min(1, index / 16, (Number(frameCount) - 1 - index) / 20);
  if (edgeTime <= 0) return anchor;
  if (edgeTime === 1) return frame;
  const amount = edgeTime ** 2 * (3 - 2 * edgeTime);
  // Mix premultiplied colors so the blend keeps a clean translucent contour.
  for (let p = 0; p < frameBytes; p += 4) {
    const a = frame[p + 3] * amount;
    const b = anchor[p + 3] * (1 - amount);
    const coverage = a + b;
    if (coverage > 0) {
      for (let channel = 0; channel < 3; channel++) {
        frame[p + channel] = Math.round((a * frame[p + channel] + b * anchor[p + channel]) / coverage);
      }
    }
    frame[p + 3] = Math.round(coverage);
  }
  return frame;
}

const decoder = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-c:v', 'libvpx-vp9', '-threads', '2', '-i', source,
  '-map', '0:v:0', '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
const encoder = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-n', '-f', 'rawvideo', '-pix_fmt', 'rgba',
  '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', '-i', source,
  '-map', '0:v:0', '-map_metadata', '1', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
  '-lossless', '1', '-auto-alt-ref', '0', '-row-mt', '1', '-threads', '3', '-cpu-used', '4', candidate]);
const decoded = once(decoder, 'close'), encoded = once(encoder, 'close');
decoded.catch(() => {});
encoded.catch(() => {});
decoder.stderr.pipe(process.stderr);
encoder.stderr.pipe(process.stderr);
let drained = Buffer.alloc(0), frames = 0;
try {
  for await (const chunk of decoder.stdout) {
    drained = drained.length ? Buffer.concat([drained, chunk]) : chunk;
    while (drained.length >= frameBytes) {
      const frame = drained.subarray(0, frameBytes);
      drained = drained.subarray(frameBytes);
      if (box) removeSmallPlatform(frame, frames);
      let figure = refine(frame);
      if (box) figure = composeMusicBox(figure, box, frames);
      if (anchor) figure = alignLoop(figure, frames);
      if (!encoder.stdin.write(figure)) await once(encoder.stdin, 'drain');
      frames++;
    }
  }
  encoder.stdin.end();
  if ((await decoded)[0] !== 0 || (await encoded)[0] !== 0 || drained.length || frames !== Number(frameCount)) {
    throw new Error('The decoded frame count or encoder result did not match the source');
  }
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
  const report = { source, sourceSha256: hash(source), candidate, candidateSha256: hash(candidate), width, height, fps, frames };
  if (box) report.plateSha256 = hash(reference);
  if (anchor) {
    report.loopAnchor = reference;
    report.loopAnchorSha256 = hash(reference);
  }
  writeFileSync(candidate.replace(/\.webm$/i, '') + '-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  decoder.kill();
  encoder.stdin.destroy();
  encoder.kill();
  throw error;
}
