import { execFileSync } from 'node:child_process';

const width = 640, height = 360;
const boxWidth = 200, boxHeight = 134;

function ease(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function prepareMusicBox(ffmpeg, file) {
  const box = execFileSync(ffmpeg, [
    '-v', 'error', '-i', file, '-vf', 'crop=1224:820:156:120,scale=200:134:flags=lanczos',
    '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-',
  ]);
  if (box.length !== boxWidth * boxHeight * 4) throw new Error('Expected a single RGBA music-box plate');
  return box;
}

// The original Flow take has a shallow wooden stand in this strip. Keep pale
// shoe pixels and mint curls where they overlap the top of the stand.
export function removeSmallPlatform(frame, index) {
  if (index < 9 || index > 94) return;
  for (let y = 284; y <= 312; y++) {
    for (let x = 268; x <= 375; x++) {
      const p = (y * width + x) * 4;
      if (!frame[p + 3]) continue;
      const r = frame[p], g = frame[p + 1], b = frame[p + 2];
      const shoe = x >= 300 && x <= 339 && y <= 290 && g >= 145 && r - b < 52 && b <= g + 12;
      const curl = y <= 292 && g >= 147 && r - g < 14 && b <= g + 16;
      if (!shoe && !curl) frame[p + 3] = 0;
    }
  }
}

// Interpolate in premultiplied space so clear RGB does not bleed into a
// partially transparent pixel when either layer changes size.
function draw(canvas, source, sourceWidth, sourceHeight, left, top, scale, opacity) {
  if (scale <= 0 || opacity <= 0) return;
  const right = Math.min(width, Math.ceil(left + sourceWidth * scale));
  const bottom = Math.min(height, Math.ceil(top + sourceHeight * scale));
  for (let y = Math.max(0, Math.ceil(top)); y < bottom; y++) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y - top) / scale));
    const iy = Math.floor(sy), fy = sy - iy;
    const y1 = Math.min(iy + 1, sourceHeight - 1);
    for (let x = Math.max(0, Math.ceil(left)); x < right; x++) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x - left) / scale));
      const ix = Math.floor(sx), fx = sx - ix;
      const x1 = Math.min(ix + 1, sourceWidth - 1);
      const p0 = (iy * sourceWidth + ix) * 4, p1 = (iy * sourceWidth + x1) * 4;
      const p2 = (y1 * sourceWidth + ix) * 4, p3 = (y1 * sourceWidth + x1) * 4;
      const a0 = source[p0 + 3] * (1 - fx) * (1 - fy);
      const a1 = source[p1 + 3] * fx * (1 - fy);
      const a2 = source[p2 + 3] * (1 - fx) * fy;
      const a3 = source[p3 + 3] * fx * fy;
      const alpha = a0 + a1 + a2 + a3;
      if (alpha * opacity < 1) continue;
      const p = (y * width + x) * 4;
      const behind = canvas[p + 3] * (1 - alpha * opacity / 255);
      const coverage = alpha * opacity + behind;
      for (let channel = 0; channel < 3; channel++) {
        const premultiplied = a0 * source[p0 + channel] + a1 * source[p1 + channel] +
          a2 * source[p2 + channel] + a3 * source[p3 + channel];
        canvas[p + channel] = Math.round((premultiplied * opacity + behind * canvas[p + channel]) / coverage);
      }
      canvas[p + 3] = Math.round(coverage);
    }
  }
}

export function composeMusicBox(figure, box, frame) {
  const reveal = ease((frame - 5) / 19) * (1 - ease((frame - 81) / 20));
  if (reveal === 0) return figure;
  const canvas = Buffer.alloc(figure.length);
  const foot = 289 - 68 * reveal;
  const figureScale = 1 - .14 * reveal;
  draw(canvas, box, boxWidth, boxHeight, 320 - boxWidth * reveal / 2, foot - 7 * reveal, reveal, ease(reveal * 1.7));
  draw(canvas, figure, width, height, 320 - 320 * figureScale, foot - 289 * figureScale, figureScale, 1);
  return canvas;
}
