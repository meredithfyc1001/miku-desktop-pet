import test from 'node:test';
import assert from 'node:assert/strict';
import { pinkFloorOpacity } from './pink-floor-shadow.mjs';

test('pink floor cleanup keeps shoes, small red details and outer margins', () => {
  const base = { x: 360, y: 330, width: 640, height: 360, backgroundR: 221, backgroundG: 67, backgroundB: 151 };
  assert.equal(pinkFloorOpacity({ ...base, r: 188, g: 54, b: 124 }), 0);
  const feather = pinkFloorOpacity({ ...base, y: 280, r: 188, g: 54, b: 124 });
  assert.ok(feather > 0 && feather < 1); // gradual transition, not a horizontal cut
  assert.equal(pinkFloorOpacity({ ...base, r: 34, g: 39, b: 52 }), 1); // dark shoe
  assert.equal(pinkFloorOpacity({ ...base, r: 240, g: 244, b: 240 }), 1); // white shoe
  assert.equal(pinkFloorOpacity({ ...base, r: 160, g: 45, b: 50 }), 1); // red ornament
  assert.equal(pinkFloorOpacity({ ...base, x: 600, r: 188, g: 54, b: 124 }), 1); // outer margin
  assert.equal(pinkFloorOpacity({ ...base, y: 200, r: 188, g: 54, b: 124 }), 1); // upper character
  assert.equal(pinkFloorOpacity({ ...base, backgroundB: 70, r: 188, g: 54, b: 124 }), 1); // another backdrop
});
