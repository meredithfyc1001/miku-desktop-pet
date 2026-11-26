/** Clean matte edges in an already aligned "Miku With You" desktop clip. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [input, output, expectedCount] = process.argv.slice(2);
const frames = Number(expectedCount);
if (!input || !output || !Number.isInteger(frames) || frames <= 0) {
  throw new Error('Usage: node tools/dsh/polish-classic-contours.mjs <aligned.webm> <new.webm> <frames>');
}
if (existsSync(output) || existsSync(output + '.json')) {
  throw new Error('Use a new output path. The input clip and previous reviews must remain recoverable.');
}
const ffmpeg = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../media/node_modules/ffmpeg-static/ffmpeg.exe'
);
const width = 640,
  height = 360,
  area = width * height,
  cw = width / 2,
  ch = height / 2,
  cells = cw * ch;
const frameBytes = area * 2 + cells * 2;
const args = ['-nostdin', '-v', 'error'];
const sourceInfo = spawnSync(ffmpeg, ['-hide_banner', '-i', input, '-frames:v', '0', '-f', 'null', '-'], {
  encoding: 'utf8'
});
if (
  sourceInfo.status !== 0 ||
  !/Video: vp9.*640x360.*24 fps/.test(sourceInfo.stderr) ||
  !/alpha_mode\s*:\s*1/i.test(sourceInfo.stderr)
) {
  throw new Error('Expected a 24 fps 640x360 VP9 desktop animation with alpha');
}
const decoder = spawn(ffmpeg, [
  ...args,
  '-threads',
  '2',
  '-c:v',
  'libvpx-vp9',
  '-i',
  input,
  '-map',
  '0:v:0',
  '-fps_mode',
  'passthrough',
  '-pix_fmt',
  'yuva420p',
  '-f',
  'rawvideo',
  '-'
]);
const encoder = spawn(ffmpeg, [
  ...args,
  '-n',
  '-f',
  'rawvideo',
  '-pix_fmt',
  'yuva420p',
  '-s',
  '640x360',
  '-framerate',
  '24',
  '-i',
  '-',
  '-i',
  input,
  '-map',
  '0:v:0',
  '-map_metadata',
  '1',
  '-an',
  '-c:v',
  'libvpx-vp9',
  '-lossless',
  '1',
  '-auto-alt-ref',
  '0',
  '-threads',
  '3',
  '-row-mt',
  '1',
  '-cpu-used',
  '4',
  output
]);
const wait = (child) =>
  new Promise((res, rej) => {
    child.once('error', rej);
    child.once('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg exited ' + code))));
  });
const decodeDone = wait(decoder),
  encodeDone = wait(encoder);
decodeDone.catch(() => {});
encodeDone.catch(() => {});
decoder.stderr.pipe(process.stderr);
encoder.stderr.pipe(process.stderr);
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
const directions = [-cw - 1, -cw, -cw + 1, -1, 1, cw - 1, cw, cw + 1];
const cover = new Uint8Array(cells);
const nearest = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
// Positive only when BOTH red and blue exceed green (BT.601, limited-range YUV).
const pink = (u, v) => Math.min(0.392 * (u - 128) + 2.409 * (v - 128), 2.409 * (u - 128) + 0.813 * (v - 128));
const sequence = createHash('sha256');
const stats = {
  frames: 0,
  framesWithEdits: 0,
  softenedPixels: 0,
  despilledCells: 0,
  excessBefore: 0,
  excessAfter: 0,
  maxAreaChangeFraction: 0,
  maxCentroidChange: 0,
  approxMaxAdjacentDifference: 0,
  strongestTransitionFrame: 0,
  holds: [],
  maxJumpInSourceCentroid: 0,
  centroidJumpFrame: 0
};
let firstSample,
  previousSample,
  previousCenter,
  previousInputHash,
  holdLength = 0;
const sampleDistance = (a, b) => {
  let total = 0,
    count = 0;
  for (let i = 0; i < a.length; i += 2) {
    if (a[i] < 24 && b[i] < 24) continue;
    total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]);
    count += 2;
  }
  return count ? total / count : 0;
};
function polish(raw) {
  const result = Buffer.from(raw);
  const lum = raw.subarray(0, area),
    u = raw.subarray(area, area + cells),
    v = raw.subarray(area + cells, area + 2 * cells);
  const alpha = raw.subarray(area + 2 * cells),
    outAlpha = result.subarray(area + 2 * cells);
  let mass = 0,
    cx = 0,
    cy = 0,
    delta = 0,
    dx = 0,
    dy = 0,
    edits = 0;
  // Work in native planar YUVA. Fully opaque interiors, luminance and the source timing are untouched.
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x,
        p = 2 * y * width + 2 * x;
      const sum = alpha[p] + alpha[p + 1] + alpha[p + width] + alpha[p + width + 1];
      cover[i] = Math.round(sum / 4);
      mass += sum;
      cx += sum * (2 * x + 0.5);
      cy += sum * (2 * y + 0.5);
    }
  for (let y = 3; y < ch - 3; y++)
    for (let x = 3; x < cw - 3; x++) {
      const i = y * cw + x,
        coverage = cover[i];
      if (!coverage) continue;
      const nearEmpty = directions.some((offset) => cover[i + offset] < 48);
      if (!nearEmpty) continue;
      // Only neutralize magenta that differs from a nearby opaque foreground sample of similar luma.
      const tint = pink(u[i], v[i]);
      const p = 2 * y * width + 2 * x;
      if (tint > 5) {
        let best = -1,
          bestDistance = Infinity;
        for (const offset of directions)
          for (let step = 1; step <= 3; step++) {
            const j = i + step * offset;
            if (cover[j] < 244 || directions.some((d) => cover[j + d] < 128)) continue;
            const q = Math.floor(j / cw) * 2 * width + (j % cw) * 2;
            const distance =
              Math.abs(lum[p] - lum[q]) * 0.16 + step * 3 + Math.hypot(u[i] - u[j], v[i] - v[j]) * 0.1;
            if (distance < bestDistance) {
              best = j;
              bestDistance = distance;
            }
          }
        if (best >= 0) {
          const excess = tint - Math.max(0, pink(u[best], v[best]));
          if (excess > 6) {
            const amount = nearest((excess - 4) / 30, 0.12, 0.88) * (1 - (0.22 * coverage) / 255);
            const nextU = Math.round(u[i] + amount * (u[best] - u[i])),
              nextV = Math.round(v[i] + amount * (v[best] - v[i]));
            result[area + i] = nextU;
            result[area + cells + i] = nextV;
            if (nextU !== u[i] || nextV !== v[i]) {
              edits++;
              stats.despilledCells++;
              stats.excessBefore += excess;
              stats.excessAfter += Math.max(0, pink(nextU, nextV) - Math.max(0, pink(u[best], v[best])));
            }
          }
        }
      }
      for (const q of [p, p + 1, p + width, p + width + 1]) {
        const a = alpha[q];
        if (!a) continue;
        const left = alpha[q - 1],
          right = alpha[q + 1],
          top = alpha[q - width],
          bottom = alpha[q + width];
        // A continuous, diagonal high-contrast edge can carry a small stair-step. Protect isolated hairs,
        // narrow parasol spokes and horizontal/vertical details. Limit each adjustment to 12% coverage.
        if (
          Math.min(left, right) > 100 ||
          Math.min(top, bottom) > 100 ||
          Math.max(left, right) < 120 ||
          Math.max(top, bottom) < 120
        )
          continue;
        const mean =
          (4 * a +
            2 * (left + right + top + bottom) +
            alpha[q - width - 1] +
            alpha[q - width + 1] +
            alpha[q + width - 1] +
            alpha[q + width + 1]) /
          16;
        const change = nearest(Math.round((mean - a) * 0.45), -30, 30);
        if (!change) continue;
        outAlpha[q] = a + change;
        delta += change;
        dx += change * (q % width);
        dy += change * Math.floor(q / width);
        stats.softenedPixels++;
        edits++;
      }
    }
  if (!mass) throw new Error('Empty foreground');
  cx /= mass;
  cy /= mass;
  stats.maxAreaChangeFraction = Math.max(stats.maxAreaChangeFraction, Math.abs(delta / mass));
  stats.maxCentroidChange = Math.max(
    stats.maxCentroidChange,
    Math.hypot((dx - cx * delta) / (mass + delta), (dy - cy * delta) / (mass + delta))
  );
  if (previousCenter) {
    const jump = Math.hypot(cx - previousCenter[0], cy - previousCenter[1]);
    if (jump > stats.maxJumpInSourceCentroid) {
      stats.maxJumpInSourceCentroid = jump;
      stats.centroidJumpFrame = stats.frames;
    }
  } else {
    stats.firstCenter = [cx, cy];
  }
  previousCenter = [cx, cy];
  const sample = Buffer.alloc((width / 8) * (height / 8) * 2);
  for (let y = 4, k = 0; y < height; y += 8)
    for (let x = 4; x < width; x += 8) {
      const j = y * width + x;
      sample[k++] = alpha[j];
      sample[k++] = Math.round((lum[j] * alpha[j]) / 255);
    }
  if (previousSample) {
    const d = sampleDistance(sample, previousSample);
    if (d > stats.approxMaxAdjacentDifference) {
      stats.approxMaxAdjacentDifference = d;
      stats.strongestTransitionFrame = stats.frames;
    }
  } else firstSample = sample;
  previousSample = sample;
  const inputHash = createHash('sha256').update(raw).digest('hex');
  if (previousInputHash === inputHash) holdLength++;
  else if (holdLength) {
    stats.holds.push({ end: stats.frames - 1, length: holdLength + 1 });
    holdLength = 0;
  }
  previousInputHash = inputHash;
  if (edits) stats.framesWithEdits++;
  stats.frames++;
  sequence.update(result);
  return result;
}
let raw = Buffer.allocUnsafe(frameBytes),
  filled = 0;
try {
  for await (const chunk of decoder.stdout) {
    for (let offset = 0; offset < chunk.length;) {
      const length = Math.min(frameBytes - filled, chunk.length - offset);
      chunk.copy(raw, filled, offset, offset + length);
      filled += length;
      offset += length;
      if (filled === frameBytes) {
        if (!encoder.stdin.write(polish(raw))) await once(encoder.stdin, 'drain');
        filled = 0;
      }
    }
  }
  await decodeDone;
  encoder.stdin.end();
  await encodeDone;
  if (filled || stats.frames !== frames) throw new Error('Frame count mismatch');
  if (holdLength) stats.holds.push({ end: frames - 1, length: holdLength + 1 });
  stats.lastCenter = previousCenter;
  stats.approxFirstLastDifference = sampleDistance(firstSample, previousSample);
  const expected = sequence.digest('hex');
  const decoded = spawnSync(
    ffmpeg,
    [
      ...args,
      '-threads',
      '2',
      '-c:v',
      'libvpx-vp9',
      '-i',
      output,
      '-map',
      '0:v:0',
      '-pix_fmt',
      'yuva420p',
      '-fps_mode',
      'passthrough',
      '-f',
      'hash',
      '-hash',
      'sha256',
      '-'
    ],
    { encoding: 'utf8' }
  );
  if (decoded.status !== 0 || !decoded.stdout.toLowerCase().includes(expected))
    throw new Error('Encoded frames differ from reviewed native YUVA sequence');
  if (stats.maxAreaChangeFraction > 0.003 || stats.maxCentroidChange > 0.2)
    throw new Error('Contour displacement exceeded safety bounds');
  writeFileSync(
    output + '.json',
    JSON.stringify(
      { inputSha256: hashFile(input), sha256: hashFile(output), decodedFrameSha256: expected, ...stats },
      null,
      2
    ) + '\n'
  );
} catch (e) {
  decoder.kill();
  encoder.stdin.destroy();
  encoder.kill();
  throw e;
}
