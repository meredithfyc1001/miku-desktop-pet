import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverEnclosedBackground } from './recover-enclosed-background.mjs';

test('removes a large enclosed backdrop while preserving similarly coloured details', () => {
  const width = 32, height = 24, pixels = width * height;
  const rgb = new Uint8Array(pixels * 3), candidates = new Uint8Array(pixels), reached = new Uint8Array(pixels);
  const rowR = new Float32Array(height).fill(180), rowG = new Float32Array(height).fill(60), rowB = new Float32Array(height).fill(80);
  function rectangle(x0, y0, x1, y1, color) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * width + x; candidates[i] = 1; rgb.set(color, i * 3);
    }
  }
  rectangle(2, 2, 10, 10, [180, 60, 80]); // enclosed backdrop
  rectangle(14, 2, 22, 10, [150, 60, 80]); // garment near the backdrop colour
  rectangle(25, 2, 29, 6, [180, 60, 80]); // small red ornament
  rectangle(2, 14, 10, 22, [180, 60, 80]);
  rectangle(6, 14, 10, 22, [140, 60, 80]); // backdrop mixed with its feathered edge
  const result = recoverEnclosedBackground({ rgb, width, height, candidates, reached, rowR, rowG, rowB });
  assert.deepEqual(result, { recoveredPixels: 128, recoveredComponents: 2 });
  assert.equal(reached[3 * width + 3], 1);
  assert.equal(reached[3 * width + 15], 0);
  assert.equal(reached[3 * width + 26], 0);
  assert.equal(reached[15 * width + 7], 1);
});

test('rejects mismatched frame dimensions', () => {
  assert.throws(() => recoverEnclosedBackground({ rgb: [], width: 2, height: 2, candidates: [], reached: [], rowR: [], rowG: [], rowB: [] }));
});

test('opt-in magenta recovery removes a small enclosed gap but keeps red costume details', () => {
  const width = 16, height = 8, pixels = width * height;
  const rgb = new Uint8Array(pixels * 3);
  const candidates = new Uint8Array(pixels), reached = new Uint8Array(pixels);
  const rowR = new Float32Array(height).fill(232);
  const rowG = new Float32Array(height).fill(56);
  const rowB = new Float32Array(height).fill(152);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) {
    const gap = y * width + x, ornament = gap + 8;
    rgb.set([227, 58, 148], gap * 3);
    rgb.set([231, 60, 105], ornament * 3);
    candidates[gap] = candidates[ornament] = 1;
  }
  const input = { rgb, width, height, candidates, reached, rowR, rowG, rowB };
  assert.equal(recoverEnclosedBackground(input).recoveredPixels, 0);
  assert.equal(recoverEnclosedBackground({ ...input, recoverSmallMagenta: true }).recoveredPixels, 16);
  assert.equal(reached[2 * width + 10], 0);
});
