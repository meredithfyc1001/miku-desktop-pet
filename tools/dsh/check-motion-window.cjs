'use strict';
// Run with Electron: check-motion-window.cjs classic|symphony [action ... | --interactions | --standing-break]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const [appearance, ...requested] = process.argv.slice(2);
assert.ok(['classic', 'symphony'].includes(appearance));
const idle = appearance === 'classic' ? '待机眨眼' : '交响乐待机';
const relax = '站久了，放松一下';
const standingBreak = requested.length === 1 && requested[0] === '--standing-break';
if (standingBreak) assert.equal(appearance, 'symphony');
const home = standingBreak ? fs.mkdtempSync(path.join(tmpdir(), 'miku-standing-break-'))
  : path.join(root, '.local-work-diagnostics/all-motion-review', 'window-' + appearance);
if (standingBreak) console.log('Standing break review fixture:', home);
const media = path.join('dsh-pet', 'pet', 'miku-animation');
const helper = path.join(root, 'integrations/dsh/runtime/runtime/electron-helper');
const catalog = require(path.join(helper, appearance === 'classic' ? 'miku-action-catalog.json' : 'miku-symphony-catalog.json'));
const interactionsOnly = requested.length === 1 && requested[0] === '--interactions';
const checkInteractions = interactionsOnly || !requested.length;
const gestures = appearance === 'classic'
  ? ['提起晃腿', '悬空轻晃', '落地站稳', '打个盹', '睡梦中', '慢慢醒来']
  : ['悬空轻摆', '悬空轻摆', '轻轻落地', '轻轻合眼', '闭眼小憩', '缓缓醒来'];
const actions = interactionsOnly || standingBreak ? [] : requested.length ? requested.map(name => {
  const action = catalog.find(row => row.name === name);
  assert.ok(action, name);
  return action;
}) : catalog;
fs.mkdirSync(path.join(home, media), { recursive: true });
fs.mkdirSync(path.join(home, 'chromium'), { recursive: true });
const config = require(path.join(root, 'integrations/dsh/pack/miku-config.json'));
const fixturePet = { ...config.pets[0], position: { corner: appearance === 'classic' ? 'bottom-left' : 'bottom-right', marginX: 38, marginY: 38 } };
const save = (name, value) => fs.writeFileSync(path.join(home, name), JSON.stringify(value, null, 2) + '\n');
save('dsh-pet/pet/miku-config.json', { ...config, pets: [fixturePet] });
save('dsh-pet/main-config.jsonc', { ...config, pets: [{ ...fixturePet, id: 'main', display: 'none' }] });
save('miku-preferences.json', { appearance, ...(standingBreak && { symphonyIdleStyle: 'front', favorites: ['正面站姿待机', '提裙致意'] }), name: 'Miku', size: 360, topmost: false, wander: false, codexStatus: false, idle: 100, turn: 0, move: 0 });
save('result.json', { appearance, status: 'running', requested: actions.length });
save('progress.json', []);
const expectedHashes = new Map();
const breakMedia = [relax, '待机眨眼', '提裙致意'];
for (const name of new Set([idle, ...actions.map(action => action.name), ...(checkInteractions ? gestures : []), ...(standingBreak ? breakMedia : [])])) {
  const filename = path.join(media, name + '.webm');
  const source = fs.readFileSync(path.join(root, 'data-dsh', filename));
  expectedHashes.set(name, createHash('sha256').update(source).digest('hex'));
  fs.writeFileSync(path.join(home, filename), source);
}
app.setName('Miku motion review ' + appearance);
app.setPath('userData', path.join(home, 'chromium'));
process.env.DSH_HOME = home;
const checks = [];
const interactions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(label, getter, timeout = 20000) {
  const stop = Date.now() + timeout;
  while (Date.now() < stop) {
    const value = await getter();
    if (value) return value;
    await delay(70);
  }
  throw new Error(label);
}
let finished = false, started = false;
function finish(data) {
  if (finished) return;
  finished = true;
  save('result.json', { appearance, catalogCount: catalog.length, checks, interactions, ...data });
  app.exit(data.passed ? 0 : 1);
}
app.on('browser-window-created', (_, win) => {
  win.webContents.on('did-finish-load', async () => {
    if (started || !/electron-helper\/index\.html/.test(win.webContents.getURL())) return;
    started = true;
    const js = code => win.webContents.executeJavaScript(code);
    const state = () => js(`(() => {
      const sprite = sprites[0];
      if (!sprite) return null;
      const v = sprite.front ? sprite.videoB : sprite.videoA;
      if (sprite.pending || v.readyState < 2 || !v.currentSrc || v.paused) return null;
      return { name: sprite.anim, path: v.currentSrc, duration: v.duration, time: v.currentTime, loop: v.loop,
        width: v.videoWidth, height: v.videoHeight, decoded: v.getVideoPlaybackQuality().totalVideoFrames };
    })()`);
    async function playing(name) {
      const s = await state();
      if (s?.name !== name || s.time < 0.06) return false;
      const url = new URL(s.path);
      return url.hostname === '127.0.0.1' && decodeURIComponent(url.pathname).endsWith('/thumb/miku/' + name + '.webm') && s;
    }
    try {
      await waitFor('Initial idle did not start', () => playing(idle));
      await js("sprites[0].onMenuAction({action:'miku-actions'});true");
      const gallery = await waitFor('Gallery did not open', async () => {
        const g = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Miku · 动作图鉴');
        return g && await g.webContents.executeJavaScript("!!document.getElementById('total')?.textContent.includes('个动作')") && g;
      });
      const entry = await gallery.webContents.executeJavaScript('window.mikuActions.list()');
      assert.equal(entry.appearance, appearance);
      assert.deepEqual(entry.catalog.map(a => a.name), catalog.map(a => a.name));
      for (const { name, video } of entry.catalog) {
        assert.equal(video, pathToFileURL(path.join(home, media, name + '.webm')).href);
      }
      gallery.hide();
      if (standingBreak) {
        const { checkStandingBreak } = require('./check-symphony-standing-break.cjs');
        await checkStandingBreak({ js, win, gallery, root, catalog: entry.catalog, playing, waitFor, checks, idle, relax });
      }
      for (const [index, action] of actions.entries()) {
        const { name, seconds } = action;
        const requestedAt = Date.now();
        assert.equal(await gallery.webContents.executeJavaScript('window.mikuActions.play(' + JSON.stringify(name) + ')'), 'playing');
        const start = await waitFor(name + ' did not start', () => playing(name));
        assert.ok(Math.abs(start.duration - seconds) < 0.02, name + ' duration');
        assert.deepEqual([start.width, start.height], [640, 360]);
        if (index === 0 || name === '八音盒旋转' || name === '整理帽子' || name === '发条开场') {
          await delay(480);
          fs.writeFileSync(path.join(home, name + '.png'), (await win.capturePage()).toPNG());
        }
        if (name === idle) {
          assert.ok(start.loop);
          let last = start.time;
          await waitFor(name + ' did not loop', async () => {
            const s = await playing(idle);
            if (!s) return false;
            const wrapped = s.time + 0.5 < last;
            last = s.time;
            return wrapped;
          }, seconds * 1000 + 16000);
        } else {
          assert.equal(start.loop, false);
          await waitFor(name + ' did not return to idle', () => playing(idle), seconds * 1000 + 16000);
        }
        checks.push({ name, seconds: start.duration, sha256: expectedHashes.get(name),
          elapsedMs: Date.now() - requestedAt, outcome: name === idle ? 'loop' : 'returned-to-idle' });
        save('progress.json', checks);
      }
      if (checkInteractions) {
        const [lift, hang, land, sleep, dream, wake] = gestures;
        const sendPointer = (type, x, y) => js(`(() => {
          const p = sprites[0], type = ${JSON.stringify(type)};
          if (type === 'pointerdown') p.lastPressAt = -Infinity;
          (type === 'pointerup' ? window : p.hit).dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerId: 81, button: 0, buttons: type === 'pointerup' ? 0 : 1,
            clientX: ${x}, clientY: ${y}, screenX: ${x}, screenY: ${y}
          }));
          return true;
        })()`);
        const menu = action => js('sprites[0].onMenuAction(' + JSON.stringify({ action }) + ');true');
        await sendPointer('pointerdown', 1000, 600);
        await sendPointer('pointermove', 940, 624);
        await waitFor('Pickup did not play', () => playing(lift));
        assert.ok((await waitFor('Held pose did not play', () => playing(hang))).loop);
        await delay(500);
        await sendPointer('pointerup', 940, 624);
        await waitFor('Gentle release did not play landing', () => playing(land));
        await waitFor('Landing did not return to idle', () => playing(idle));
        interactions.push({ name: 'drag-release', sequence: [...new Set([lift, hang, land, idle])] });
        await menu('sleep');
        await waitFor('Sleep entry did not play', () => playing(sleep));
        assert.ok((await waitFor('Sleep loop did not start', () => playing(dream))).loop);
        await menu('wake');
        await waitFor('Wake gesture did not play', () => playing(wake));
        await waitFor('Wake did not return to idle', () => playing(idle));
        interactions.push({ name: 'sleep-wake', sequence: [sleep, dream, wake, idle] });
      }
      if (standingBreak) {
        const report = { passed: true, catalogCount: catalog.length, idle, action: relax, checks };
        fs.writeFileSync(path.join(root, 'docs/dsh交响乐放松动作检查.json'), JSON.stringify(report, null, 2) + '\n');
      }
      finish({ passed: true });
    } catch (error) {
      finish({ passed: false, error: error.stack, last: await state().catch(() => null) });
    }
  });
});
setTimeout(() => finish({ passed: false, error: 'Window review timed out' }), 120000 + actions.reduce((ms, action) => ms + (action.seconds + 6) * 1000, 0)).unref();
import(pathToFileURL(path.join(root, 'integrations/dsh/runtime/lib/app.js')).href)
  .catch(error => finish({ passed: false, error: error.stack }));
