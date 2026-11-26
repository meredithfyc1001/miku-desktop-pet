'use strict';

const { readFileSync, writeFileSync, renameSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');

const ranges = {
  size: [180, 720], marginX: [0, 10000], marginY: [0, 10000],
  fontSize: [12, 34], gravity: [400, 3000], restitution: [0, .95],
  groundFriction: [.2, 10], throwPower: [.15, 1.5],
  idle: [0, 100], turn: [0, 100], move: [0, 100],
};
const flags = ['topmost', 'wander', 'followPet', 'confine', 'ceilingBounce', 'clickSound', 'codexStatus'];
const choices = {
  appearance: ['classic', 'symphony'],
  corner: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  family: ['candy', 'system', 'yahei', 'youyuan', 'kaiti', 'simsun', 'comic'],
  whisper: [null, 0, 5, 15, 30],
};

function valid(key, value) {
  if (key === 'favorites') return Array.isArray(value) &&
    value.every(name => typeof name === 'string' && name.length > 0 && name.length <= 120);
  if (key === 'name') return typeof value === 'string' && value.trim().length > 0 && value.length <= 40;
  if (Object.hasOwn(ranges, key)) {
    const [min, max] = ranges[key];
    return Number.isFinite(value) && value >= min && value <= max;
  }
  if (Object.hasOwn(choices, key)) return choices[key].includes(value);
  return flags.includes(key) && typeof value === 'boolean';
}

function validateUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式有误。');
  const entries = Object.entries(input);
  if (entries.some(([key, value]) => !valid(key, value))) throw new Error('有选项超出可用范围。');
  return Object.fromEntries(entries.map(([key, value]) => [key, key === 'name' ? value.trim() : value]));
}

function loadPreferences(home) {
  try {
    const saved = JSON.parse(readFileSync(join(home, 'miku-preferences.json'), 'utf8'));
    const prefs = Object.fromEntries(Object.entries(saved ?? {}).filter(([key, value]) => valid(key, value)));
    if (prefs.favorites?.includes('正面站姿待机')) {
      prefs.favorites = [...new Set(prefs.favorites.map(name => name === '正面站姿待机' ? '站久了，放松一下' : name))];
    }
    return prefs;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function savePreferences(home, changes, effective) {
  const next = { ...loadPreferences(home), ...validateUpdate(changes) };
  if (effective && (next.idle ?? effective.idle) + (next.turn ?? effective.turn) + (next.move ?? effective.move) > 100) {
    throw new Error('三项动作频率加起来不能超过 100%。');
  }
  const file = join(home, 'miku-preferences.json');
  const tmp = file + '.pending';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  try { renameSync(tmp, file); }
  catch (error) {
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
  return next;
}

function effectivePreferences(merged, saved, topmost) {
  const entry = merged?.miku;
  const pet = entry?.pets?.find(pet => pet.id === 'miku');
  if (!pet) throw new Error('暂时读不到 Miku 的配置。');
  const font = entry.font ?? merged.main?.font ?? {};
  const physics = entry.physics ?? merged.main?.physics ?? {};
  const weights = entry.animationWeights ?? {};
  return {
    name: saved.appearance === 'symphony' ? 'Miku · 交响乐 2020' : pet.name || 'Miku',
    size: pet.size, corner: pet.position.corner,
    marginX: pet.position.marginX, marginY: pet.position.marginY, topmost,
    wander: !pet.fixedEnabled, fontSize: font.size ?? 18, family: font.family ?? 'system',
    followPet: font.followPet ?? true, confine: entry.confineToScreen === true || merged.main?.confineToScreen === true,
    clickSound: merged.main?.clickSoundEnabled === true, whisper: null,
    codexStatus: false,
    gravity: physics.gravity ?? 1400, restitution: physics.restitution ?? .55,
    groundFriction: physics.groundFriction ?? 3, throwPower: physics.throwPower ?? .65,
    ceilingBounce: physics.ceilingBounce ?? true,
    idle: weights.idle ?? 88, turn: weights.turn ?? 3, move: weights.move ?? 3,
    ...saved,
  };
}

module.exports = { loadPreferences, savePreferences, validateUpdate, effectivePreferences, isValidPreference: valid };
