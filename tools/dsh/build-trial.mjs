/** Build a local Miku adapter around the pinned dsh-pet runtime. No upstream assets are bundled. */
import { cpSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { collectReadyPreviews, selectActiveClips } from './preview-assets.mjs';
import { buildActionCatalog } from './action-catalog.mjs';
import { loadSymphony, standingBreak } from './symphony.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const upstream=join(root,'tools/upstream/dsh-pet');
const pkg=join(upstream,'dsh-pet');
const dest=join(root,'integrations/dsh/runtime');
const pack=join(root,'integrations/dsh/pack');
const data=join(root,'data-dsh');
const manifest=JSON.parse(readFileSync(join(pack,'miku-animation/manifest.json'),'utf8'));
const activeClips=selectActiveClips(collectReadyPreviews(root));
const { clips: symphonyClips, groups: symphonyGroups, ...symphony } = loadSymphony(root);
// Both appearances are installed in the same animation directory on Windows.
const classicTargets = new Set(activeClips.map(clip => clip.target.toLowerCase()));
const sharedTargets = symphonyClips.filter(clip => classicTargets.has(clip.target.toLowerCase()));
if (sharedTargets.length) {
  throw new Error('Miku appearances share animation filenames: ' + sharedTargets.map(clip => clip.target).join(', '));
}
const menuOnlyActions=activeClips.filter(clip=>clip.menuOnly).map(clip=>clip.target);
const lifeActions=activeClips.filter(clip=>clip.lifeAction).map(clip=>clip.target);
const clickActions=activeClips.filter(clip=>clip.clickAction).map(clip=>clip.target);
const quotaVideos=Object.fromEntries(activeClips.filter(clip=>clip.quotaTier).map(clip=>[clip.quotaTier,clip.target]));
const catalogActionNames = activeClips.map(clip => clip.target);
const settings=readFileSync(join(root,'datafilm/settings.xml'),'utf8');
const setting=(key,fallback)=>settings.match(new RegExp(`<${key}>([^<]+)</${key}>`))?.[1]??fallback;
const missing=manifest.clips.filter(({name})=>!activeClips.some(clip=>clip.target===name));
if(missing.length)throw new Error('Missing approved Miku animations: '+missing.map(clip=>clip.name).join(', '));
if(!existsSync(join(pkg,'lib/app.js')))throw new Error('Build the upstream source first.');
mkdirSync(dest,{recursive:true});
for(const dir of ['lib','runtime'])cpSync(join(pkg,dir),join(dest,dir),{recursive:true});
for (const file of ['miku-whisper.js','miku-quota.js','miku-quota.css','codex-quota.cjs','miku-codex-status.cjs','miku-codex-status-sprite.js'])
  cpSync(join(root,'tools/dsh',file),join(dest,'runtime/electron-helper',file));
for (const file of ['miku-preferences.cjs','miku-settings-main.cjs','miku-settings-preload.cjs','miku-settings.html','miku-settings.css','miku-settings.js'])
  cpSync(join(root,'tools/dsh',file),join(dest,'runtime/electron-helper',file));
for (const file of ['miku-actions-main.cjs','miku-actions-preload.cjs','miku-actions.html','miku-actions.css','miku-actions.js','miku-actions-sprite.js'])
  cpSync(join(root,'tools/dsh',file),join(dest,'runtime/electron-helper',file));
cpSync(join(root,'assets/video-production/revised/flow-idle/aligned-first.png'),join(dest,'runtime/electron-helper/miku-settings-art.png'));
cpSync(join(root,'assets/video-production/revised/flow-idle/aligned-candidate.webm'),join(dest,'runtime/electron-helper/miku-settings-idle.webm'));
mkdirSync(join(dest,'assets'),{recursive:true});
cpSync(join(pkg,'assets/config.jsonc'),join(dest,'assets/config.jsonc'));
cpSync(join(pack,'miku-animation/待机眨眼.png'),join(dest,'assets/logo.png'));
cpSync(join(upstream,'LICENSE'),join(dest,'LICENSE.dsh-pet'));
writeFileSync(join(dest,'package.json'),JSON.stringify({name:'miku-video-pet',version:'0.2.0',type:'module'},null,2));

// Apply only guarded, reproducible adaptations to the copied runtime.
function patch(file,from,to,count=1){
  const path=join(dest,file),source=readFileSync(path,'utf8');
  if(source.split(from).length-1!==count)throw new Error(`Upstream changed: ${file}`);
  writeFileSync(path,source.split(from).join(to));
}
patch('runtime/electron-helper/miku-quota.js','const MIKU_QUOTA_VIDEOS = {};',
  `const MIKU_QUOTA_VIDEOS = ${JSON.stringify(quotaVideos)};`);
for(const file of ['sprite/playback.js','sprite/motion.js'])
  patch('runtime/electron-helper/'+file,"this.facing === 'right' ? 'scaleX(-1)'", "this.assetRoot !== 'miku' && this.facing === 'right' ? 'scaleX(-1)'");
patch('runtime/electron-helper/sprite/motion.js',"this.facing === 'right' ? 'scaleX(-1) '","this.assetRoot !== 'miku' && this.facing === 'right' ? 'scaleX(-1) '");
patch('runtime/electron-helper/sprite/playback.js','    el.loop = !nextOnce;',`    const nativeIdle = nextOnce && !playbackId && !url &&
      this.assetRoot === 'miku' && this.animations.idle?.includes(next);
    el.loop = nativeIdle || !nextOnce || (this.assetRoot === 'miku' &&
      this.dragState.dragging && next !== '提起晃腿' && this.animations.drag.includes(next));
    el.ontimeupdate = null;
    if (nativeIdle) {
      let previousTime = 0;
      el.ontimeupdate = () => {
        const time = el.currentTime;
        const wrapped = previousTime > el.duration * .75 && time < el.duration * .25;
        previousTime = time;
        if (!wrapped || this.pending || (this.front === 0 ? this.videoA : this.videoB) !== el) return;
        // Run the ordinary random-action decision at the loop boundary. If it
        // chooses idle again, Chromium is already playing the next cycle.
        this.mikuIdleWrapped = next;
        try { this.handleEnded(); }
        finally { this.mikuIdleWrapped = null; }
      };
    }`);
patch('runtime/electron-helper/sprite/playback.js','    el.onended = nextOnce ? () => this.handleEnded() : null;',
  '    el.onended = nextOnce && !nativeIdle ? () => this.handleEnded() : null;');
patch('runtime/electron-helper/sprite/playback.js','        old.onended = null;',
  '        old.onended = null;\n        old.ontimeupdate = null;');
patch('runtime/electron-helper/sprite/playback.js','    if (this.dragState.active) return;',`    if (this.dragState.active) {
      if (this.assetRoot === 'miku' && this.dragState.dragging && this.anim === '提起晃腿' && this.animations.drag.length) {
        const suspended = S.pick(this.animations.drag);
        this.anim = suspended;
        this.once = false;
        this.switchTo(suspended, false);
      }
      return;
    }`);
patch('runtime/electron-helper/sprite/playback.js','if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {',
  `if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim) || (this.assetRoot === 'miku' && (this.mikuQuotaProp || this.anim === this.pet?.mikuLanding || ${JSON.stringify(['落地站稳',...lifeActions,...Object.values(quotaVideos)])}.includes(this.anim)))) {`);
patch('runtime/electron-helper/sprite/playback.js','const isEvent = S.isEventAnim(animations.events, this.anim);',
  "const isEvent = !(this.assetRoot === 'miku' && animations.idle.includes(this.anim)) && S.isEventAnim(animations.events, this.anim);");
patch('runtime/electron-helper/sprite/motion.js',"const token = ++this.squashToken;","if (this.assetRoot === 'miku') depth = Math.max(.9, depth);\n    const token = ++this.squashToken;");
patch('runtime/electron-helper/sprite/input.js','this.playOnce(S.pick(this.animations.drag));',
  "this.playOnce(this.assetRoot === 'miku' && this.pet?.mikuAppearance !== 'symphony' ? '提起晃腿' : S.pick(this.animations.drag));");
patch('runtime/electron-helper/sprite/input.js',`    playClickSound();
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(this.animations.clicks));`, `    playClickSound();
    const respond = () => {
      if (!this.animations.clicks.length) return;
      this.pendingSquash = true;
      this.playOnce(S.pick(this.animations.clicks));
    };
    if (this.assetRoot === 'miku') this.playMikuClick(e.detail, respond);
    else respond();`);
patch('runtime/electron-helper/sprite/input.js','    if (isOpenShortcut(e)) {\n      this.stopThrow();', `    if (isOpenShortcut(e)) {
      if (this.assetRoot === 'miku') this.cancelMikuActionClick();
      this.stopThrow();`);
patch('runtime/electron-helper/sprite/playback.js','  switchTo(next, nextOnce, playbackId, url) {',
  `  switchTo(next, nextOnce, playbackId, url) {
    if (this.assetRoot === 'miku') this.mikuCatalogPlaying = null;
    if (this.pet?.mikuAppearance === 'symphony' && !url && !this.pet.mikuActionNames.has(next)) {
      next = this.anim = this.animations.idle[0];
    }
    if (next && this.mikuIdleWrapped === next && nextOnce && !playbackId && !url) return;`);
patch('runtime/electron-helper/sprite/playback.js',
  "      el.onerror = null;\n      if (this.pending && this.pending.gen !== gen) return;",
  "      if (this.pending?.gen !== gen) return;\n      el.onerror = null;");
patch('runtime/electron-helper/sprite/playback.js',
  "      this.reportPlayback(done, 'ended');\n    }",
  "      this.reportPlayback(done, 'ended');\n    }\n    if (this.assetRoot === 'miku' && this.pending) return;");
patch('runtime/electron-helper/sprite/playback.js',
  "    };\n    const loadTimer = window.setTimeout",
  `      if (this.assetRoot === 'miku' && !this.frozen && !this.sleeping && !this.dragState.active) {
        const front = this.front === 0 ? this.videoA : this.videoB;
        const idle = this.animations.idle?.[0];
        if (front?.ended && idle && next !== idle) this.playOnce(idle);
      }
    };
    const loadTimer = window.setTimeout`);
patch('runtime/electron-helper/sprite/playback.js','    this.sleepSet = { start: state.start, loop: state.loop, end: state.end };',`    this.hostSleepSet = { start: state.start, loop: state.loop, end: state.end };
    this.sleepSet = this.pet.mikuSleep ?? this.hostSleepSet;`);
patch('runtime/electron-helper/sprite/playback.js','    this.playOnce(state.start);','    this.playOnce(this.sleepSet.start);');
// Local menu selections play through once, including a walk which also moves the window.
patch('runtime/electron-helper/sprite/menu.js',
  "      else if (moved === true && playbackId) this.reportPlayback(playbackId, 'failed', 'busy');",
  `      else if (moved === true && playbackId) this.reportPlayback(playbackId, 'failed', 'busy');
      if (moved !== true && !fromHost && !playbackId && this.pet?.mikuAppearance === 'symphony') this.mikuCatalogPlaying = leaf.anim;`);
patch('runtime/electron-helper/sprite/menu.js','    this.playOnce(leaf.anim, playbackId);\n  },',
  `    this.playOnce(leaf.anim, playbackId);
    if (!fromHost && !playbackId && this.pet?.mikuAppearance === 'symphony') this.mikuCatalogPlaying = leaf.anim;
  },`);
patch('runtime/electron-helper/sprite/playback.js',
  '        this.sleepPhase = null;\n        this.playIdle();',
  `        this.sleepPhase = null;
        if (this.pet?.mikuAppearance === 'symphony' && !this.frozen) this.playOnce(this.animations.idle[0]);
        else this.playIdle();`);
patch('runtime/electron-helper/sprite/playback.js','    const { animations } = { animations: this.animations };', `    const { animations } = { animations: this.animations };
    if (this.assetRoot === 'miku' && (this.mikuCatalogPlaying === this.anim || this.anim === ${JSON.stringify(standingBreak)})) {
      this.mikuCatalogPlaying = null;
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }`);
patch('runtime/electron-helper/sprite/input.js','if (!this.sleeping && !this.resumeWorkStatusAnim()) {',`const resumeIdle = !this.sleeping && !this.resumeWorkStatusAnim();
      const playMikuLanding = this.assetRoot === 'miku' && Boolean(this.pet.mikuLanding) && resumeIdle && !this.frozen;
      if (resumeIdle && !playMikuLanding) {`);
patch('runtime/electron-helper/sprite/input.js','this.startThrow(px, py, v.vx, v.vy);','this.startThrow(px, py, v.vx, v.vy, playMikuLanding);');
patch('runtime/electron-helper/sprite/input.js','this.startThrow(px, py, vel.vx, vel.vy);','this.startThrow(px, py, vel.vx, vel.vy, playMikuLanding);');
patch('runtime/electron-helper/sprite/input.js','window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };',
  "window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };\n          if (playMikuLanding) this.playOnce(this.pet.mikuLanding);");
patch('runtime/electron-helper/sprite/motion.js','  startThrow(px, py, vx, vy) {\n    this.stopDragFollow();\n    this.stopMove();',`  startThrow(px, py, vx, vy, playMikuLanding = false) {
    this.stopDragFollow();
    this.stopMove();
    const suspended = playMikuLanding && this.animations.drag.length ? S.pick(this.animations.drag) : null;
    if (suspended) {
      this.anim = suspended;
      this.once = false;
      this.switchTo(suspended, false);
    }`);
patch('runtime/electron-helper/sprite/motion.js','window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };',
  "window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };\n        if (suspended && this.anim === suspended && !this.sleeping && !this.frozen) this.playOnce(this.pet.mikuLanding);");
patch('runtime/electron-helper/main.js',"if (APP_MODE) app.setPath('userData', path.join(app.getPath('appData'), 'dsh-pet'));", "if (APP_MODE) app.setPath('userData', path.join(process.env.DSH_HOME, 'chromium'));");
patch('runtime/electron-helper/main.js','/** 托盘：显示开关与退出入口。 */',`const mikuCodex = require('./miku-codex-status.cjs').createStatusMonitor({
  publish(event) {
    for (const win of petWindows.state.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('miku:codex-status', event);
    }
  },
});
app.once('will-quit', () => mikuCodex.setEnabled(false));
const openMikuSettings = require('./miku-settings-main.cjs').registerSettings({
  ipcMain, petWindows, shell, hostRequest: bridge.hostRequest, petRoute: PET_ROUTE, topmostLevel,
  onPreferencesSaved: prefs => mikuCodex.setEnabled(prefs.codexStatus === true),
});
const openMikuActions = require('./miku-actions-main.cjs').registerActions({ ipcMain, petWindows });
try {
  const prefs = require('./miku-preferences.cjs').loadPreferences(process.env.DSH_HOME);
  mikuCodex.setEnabled(prefs.codexStatus === true);
  if (typeof prefs.topmost === 'boolean') process.env.MIKU_TOPMOST = String(prefs.topmost);
} catch (error) { console.error('[Miku] 无法读取个性化设置', error.message); }
/** 托盘：显示开关与退出入口。 */`);
patch('runtime/electron-helper/main.js','const tray = createTray({\n  app,','const tray = createTray({\n  openMikuSettings,\n  openMikuActions,\n  app,');
patch('runtime/electron-helper/main/tray.js','  helperDir,\n})','  helperDir,\n  openMikuSettings,\n  openMikuActions,\n})');
patch('runtime/electron-helper/main/tray.js','        Menu.buildFromTemplate([',`        Menu.buildFromTemplate([
          ...(openMikuActions ? [{ label: '动作图鉴', click: openMikuActions }] : []),
          ...(openMikuSettings ? [{ label: '桌宠设置', click: openMikuSettings }] : []),`);
// Respect the existing Miku always-on-top preference, including the watchdog.
patch('runtime/electron-helper/main/windows.js','win.setAlwaysOnTop(true, topmostLevel(process.platform));',"win.setAlwaysOnTop(process.env.MIKU_TOPMOST !== 'false', topmostLevel(process.platform));",2);
patch('runtime/electron-helper/main/windows.js','alwaysOnTop: true,',"alwaysOnTop: process.env.MIKU_TOPMOST !== 'false',");
patch('runtime/electron-helper/index.html','<title>dsh-pet 桌宠（桌面模式）</title>','<title>Miku 桌宠</title>');
patch('runtime/electron-helper/main/tray.js','.filter((pet) => pet.id);',".filter((pet) => pet.id === 'miku');");
patch('runtime/electron-helper/main/tray.js',"tray.setToolTip('dsh-pet 桌面宠物');","tray.setToolTip('Miku 桌宠');");
// Isolate the two fading video layers from the desktop, then add their light
// instead of stacking two translucent layers. Matching frames stay opaque at
// the midpoint of a crossfade instead of briefly showing the desktop through.
patch('runtime/electron-helper/index.html','</head>','<style>.pet-stage{isolation:isolate}.pet-stage>video.pet-video{mix-blend-mode:plus-lighter}.pet-hit{cursor:grab!important}.pet-hit.dragging{cursor:grabbing!important}</style><link rel="stylesheet" href="./miku-quota.css"></head>');
patch('runtime/electron-helper/index.html','<script src="./renderer.js"></script>',
  '<script src="./miku-whisper.js"></script>\n    <script src="./miku-quota.js"></script>\n    <script src="./miku-actions-sprite.js"></script>\n    <script src="./miku-codex-status-sprite.js"></script>\n    <script src="./renderer.js"></script>');
patch('runtime/electron-helper/sprite.js','    this.bindEvents();',
  "    this.bindEvents();\n    if (this.assetRoot === 'miku') this.initMikuWhisper();");
patch('runtime/electron-helper/sprite.js','  dispose() {',
  "  dispose() {\n    if (this.assetRoot === 'miku') { this.disposeMikuWhisper(); this.clearMikuQuotaProp(); this.cancelMikuActionClick(); }");
patch('runtime/electron-helper/sprite/init.js','    this.animations = pet.animations;',
  `    this.animations = this.assetRoot === 'miku' && pet.mikuAppearance !== 'symphony'
      ? {...pet.animations, clicks: [...new Set([...pet.animations.clicks, ...${JSON.stringify(clickActions)}])]}
      : pet.animations;`);
patch('runtime/electron-helper/preload.js',"contextBridge.exposeInMainWorld('petBridge', {", `contextBridge.exposeInMainWorld('petBridge', {
  quitMiku() { ipcRenderer.send('miku:quit'); },
  openMikuSettings() { ipcRenderer.send('miku:settings:open'); },
  openMikuActions() { ipcRenderer.send('miku:actions:open'); },
  setMikuAppearance(value) { return ipcRenderer.invoke('miku:appearance', value); },
  onMikuAction(listener) {
    ipcRenderer.on('miku:actions:play', (_event, id, name) => {
      ipcRenderer.send('miku:actions:played', id, listener(name) === true);
    });
  },
  onMikuFavoritesChanged(listener) { ipcRenderer.on('miku:favorites:changed', (_event, names) => listener(names)); },
  onMikuCodexStatus(listener) { ipcRenderer.on('miku:codex-status', (_event, status) => listener(status)); },
  readMikuPreferences() { return ipcRenderer.invoke('miku:preferences'); },
  saveMikuWhisperInterval(minutes) { return ipcRenderer.invoke('miku:preferences:whisper', minutes); },
  onMikuPreferencesChanged(listener) { ipcRenderer.on('miku:preferences:changed', (_event, keys) => listener(keys)); },
  readCodexQuota() { return ipcRenderer.invoke('miku:codex-quota'); },`);
patch('runtime/electron-helper/renderer.js','  return {\n    pets: S.flattenConfigPets(merged),',`  const prefs = await window.petBridge?.readMikuPreferences?.().catch(() => ({})) ?? {};
  const pets = S.flattenConfigPets(merged);
  const pet = pets.find(pet => pet.id === 'miku');
  const font = merged?.miku?.font || merged?.main?.font || S.DEFAULT_FONT;
  const physics = merged?.miku?.physics || merged?.main?.physics || S.DEFAULT_PHYSICS;
  if (pet) {
    pet.mikuAppearance = prefs.appearance ?? 'classic';
    const symphony = pet.mikuAppearance === 'symphony';
    pet.name = prefs.name ?? (symphony ? 'Miku · 交响乐 2020' : pet.name);
    pet.size = prefs.size ?? pet.size;
    pet.fixedEnabled = prefs.wander === undefined ? pet.fixedEnabled : !prefs.wander;
    pet.mikuWhisperInterval = prefs.whisper;
    pet.mikuActionNames = symphony ? MIKU_SYMPHONY_NAMES : MIKU_ACTION_NAMES;
    pet.mikuLanding = symphony ? MIKU_SYMPHONY.landing : '落地站稳';
    pet.mikuFavorites = [...new Set(prefs.favorites ?? [])].filter(name => pet.mikuActionNames.has(name));
    if (symphony) {
      pet.animations = { ...MIKU_SYMPHONY.animations };
      pet.mikuSleep = MIKU_SYMPHONY.sleep;
      pet.mikuCodexActions = MIKU_SYMPHONY.codex;
      pet.mikuQuotaActions = MIKU_SYMPHONY.quota;
    }
    pet.position = { ...pet.position, corner: prefs.corner ?? pet.position.corner,
      marginX: prefs.marginX ?? pet.position.marginX, marginY: prefs.marginY ?? pet.position.marginY };
    pet.animationWeights = { ...pet.animationWeights, idle: prefs.idle ?? pet.animationWeights?.idle,
      turn: prefs.turn ?? pet.animationWeights?.turn, move: prefs.move ?? pet.animationWeights?.move };
    if (symphony) {
      if (!pet.animations.turn.length) {
        pet.animationWeights.idle += pet.animationWeights.turn;
        pet.animationWeights.turn = 0;
      }
      if (!pet.animations.moves.actions.length) {
        pet.animationWeights.idle += pet.animationWeights.move;
        pet.animationWeights.move = 0;
      }
    }
    pet.physics = { ...physics, gravity: prefs.gravity ?? physics.gravity, restitution: prefs.restitution ?? physics.restitution,
      groundFriction: prefs.groundFriction ?? physics.groundFriction, throwPower: prefs.throwPower ?? physics.throwPower,
      ceilingBounce: prefs.ceilingBounce ?? physics.ceilingBounce };
    pet.font = { ...font, family: prefs.family ?? font.family, size: prefs.fontSize ?? font.size,
      followPet: prefs.followPet ?? font.followPet };
    if (typeof prefs.confine === 'boolean') pet.confineToScreen = prefs.confine;
  }
  return {
    pets,`);
patch('runtime/electron-helper/renderer.js','confineToScreen: (merged && merged.main && merged.main.confineToScreen) === true,',
  'confineToScreen: prefs.confine ?? (merged?.main?.confineToScreen === true),');
patch('runtime/electron-helper/renderer.js','clickSoundEnabled: (merged && merged.main && merged.main.clickSoundEnabled) === true,',
  'clickSoundEnabled: prefs.clickSound ?? (merged?.main?.clickSoundEnabled === true),');
patch('runtime/electron-helper/renderer.js','font: (merged && merged.main && merged.main.font) || S.DEFAULT_FONT,',
  'font: pet?.font || font,');
patch('runtime/electron-helper/sprite.js','    this.sendBounds(x, y);\n  }\n\n  /** 抛掷空间',
  `    if (this.assetRoot === 'miku' && !this.customPos) {
      const area = PRIMARY_AREA || { x: 0, y: 0, width: W, height: H };
      x = Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - this.size)));
      y = Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - this.height)));
    }
    this.sendBounds(x, y);
  }

  /** 抛掷空间`);
patch('runtime/electron-helper/renderer.js','async function boot() {','async function boot(keepPosition = false) {');
patch('runtime/electron-helper/renderer.js','    for (const s of sprites) s.playIdle();',`    for (const s of sprites) {
      if (sleep && s.animations.sleep?.length) s.setSleep(sleep);
      else if (current?.pet.mikuAppearance !== s.pet.mikuAppearance && s.assetRoot === 'miku') s.playOnce(s.animations.idle[0]);
      else s.playIdle();
    }`);
patch('runtime/electron-helper/renderer.js','    for (const s of sprites) s.dispose();\n    sprites = [new PetSprite(pet)];',`    const current = sprites[0];
    const previous = keepPosition && current ? { rx: current.currentCenterX() / VIEW.w, ry: current.currentCenterY() / VIEW.h } : null;
    const sleep = current?.sleeping && current.sleepPhase !== 'end'
      ? { sleeping: true, ...current.hostSleepSet } : null;
    for (const s of sprites) s.dispose();
    sprites = [new PetSprite(pet)];
    if (previous) {
      sprites[0].customPos = previous;
      sprites[0].relayout({ x: VIEW.x, y: VIEW.y, w: VIEW.w, h: VIEW.h });
    }`);
patch('runtime/electron-helper/renderer.js','injectAssets();\nvoid boot();',`const MIKU_ACTION_NAMES = new Set(${JSON.stringify(catalogActionNames)});
const MIKU_SYMPHONY = ${JSON.stringify(symphony)};
const MIKU_SYMPHONY_NAMES = new Set(MIKU_SYMPHONY.names);
const MIKU_CLASSIC_SLEEP = { start: '打个盹', loop: '睡梦中', end: '慢慢醒来' };
window.petBridge?.onMikuPreferencesChanged?.(keys => {
  if (keys.some(key => !['topmost', 'codexStatus'].includes(key))) {
    void boot(!keys.some(key => ['corner', 'marginX', 'marginY'].includes(key)));
  }
});
window.petBridge?.onMikuFavoritesChanged?.(names => {
  const pet = sprites.find(sprite => sprite.assetRoot === 'miku');
  if (pet) {
    pet.cancelMikuActionClick();
    pet.pet.mikuFavorites = names.filter(name => pet.pet.mikuActionNames.has(name));
  }
});
window.petBridge?.onMikuAction?.(name => {
  const pet = sprites.find(sprite => sprite.assetRoot === 'miku');
  return pet?.pet.mikuActionNames.has(name) && pet.playMikuCatalogAction(name) === true;
});
let lastMikuCodexEvent;
window.petBridge?.onMikuCodexStatus?.(event => {
  if (event.id === lastMikuCodexEvent || event.kind === 'idle') return;
  const sprite = sprites.find(sprite => sprite.assetRoot === 'miku');
  if (sprite?.onMikuCodexStatus(event)) lastMikuCodexEvent = event.id;
});
injectAssets();
void boot();`);
patch('runtime/electron-helper/main.js','registerIpc({ ipcMain, petWindows, shell, openTarget: OPEN_TARGET, petRoute: PET_ROUTE });',`registerIpc({ ipcMain, petWindows, shell, openTarget: OPEN_TARGET, petRoute: PET_ROUTE });
  function ownsPetWindow(event) {
    const owner = BrowserWindow.fromWebContents(event.sender);
    return owner && [...petWindows.state.windows.values()].includes(owner);
  }
  ipcMain.on('miku:quit', event => {
    if (ownsPetWindow(event)) app.quit();
  });
  ipcMain.handle('miku:codex-quota', event => {
    if (ownsPetWindow(event) && event.senderFrame === event.sender.mainFrame) {
      return require('./codex-quota.cjs').readCodexQuota();
    }
    return { status: 'unavailable' };
  });`);
patch('runtime/electron-helper/events.js','function showWhisper(text, image, url, duration, anim) {',
  'function showWhisper(text, image, url, duration, anim, mikuQuota = false) {');
patch('runtime/electron-helper/events.js',"  console.log(\n    '[dsh-pet] ' +\n      new Date().toTimeString().slice(0, 8) +\n      ' whisper pet=' +",
  "  if (!mikuQuota) console.log(\n    '[dsh-pet] ' +\n      new Date().toTimeString().slice(0, 8) +\n      ' whisper pet=' +");
patch('runtime/electron-helper/events.js','  this.whisperView = S.whisperBubbleView({ ok: true, text, ts: 0 });',
  '  this.whisperView = S.whisperBubbleView({ ok: true, text, ts: 0 });\n  this.mikuQuotaView = mikuQuota ? this.whisperView : null;');
patch('runtime/electron-helper/sprite/bubble.js',"    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);",
  "    this.bubble.classList.toggle('is-miku-quota', slot === 'whisper' && this.whisperView === this.mikuQuotaView);\n    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);");
patch('runtime/electron-helper/sprite/menu.js','if (!tree.length) return;',`if (this.assetRoot === 'miku') {
      const {idle, clicks, turn, moves, drag, categories} = this.animations;
      const daily = categories.find(category => category.id === '小动作')?.actions ?? [];
      const pickup = categories.find(category => category.id === '动作查看')?.actions ?? [];
      const symphony = this.pet.mikuAppearance === 'symphony';
      const groups = symphony ? ${JSON.stringify(symphonyGroups.filter(group => group.label !== '睡眠'))} : [
        {label:'日常', names:[...idle, ...clicks, ...turn, ...daily]},
        ...categories.filter(category => !['小动作', '动作查看'].includes(category.id))
          .map(category => ({label:category.id, names:category.actions})),
        {label:'生活趣味', names:${JSON.stringify(lifeActions)}},
        {label:'额度动作', names:${JSON.stringify(Object.values(quotaVideos))}},
        {label:'移动与拖拽', names:[...moves.actions.map(move => move.name), ...${JSON.stringify(menuOnlyActions)}, ...pickup, ...drag]},
      ];
      const shown = new Set();
      const children = groups.map(({label, names}) => {
        const actions = [];
        for (const name of names) {
          if (shown.has(name)) continue;
          shown.add(name);
          actions.push({label:name, anim:name});
        }
        return {label, children:actions};
      }).filter(group => group.children.length);
      tree.splice(0, tree.length,
        ...tools.filter(item => ['todo', 'sleep', 'wake', 'home'].includes(item.action)),
        this.mikuWhisperMenu(),
        {label:'查看 Codex 额度', action:'miku-codex-quota'},
        {label:'动作', children},
        {label:'动作图鉴', action:'miku-actions'},
        {label:'切换形象', children:[
          {label:(symphony ? '○ ' : '● ') + '未来有你 2021', action:'miku-appearance', value:'classic'},
          {label:(symphony ? '● ' : '○ ') + '交响乐 2020', action:'miku-appearance', value:'symphony'},
        ]},
        {label:'桌宠设置', action:'miku-settings'},
        {label:'退出桌宠', action:'miku-quit'});
    }
    if (!tree.length) return;`);
patch('runtime/electron-helper/sprite/menu.js',"if (!leaf || typeof leaf !== 'object') return;", `if (!leaf || typeof leaf !== 'object') return;
    if (this.assetRoot === 'miku') {
      if (leaf.action === 'miku-actions') return window.petBridge.openMikuActions();
      if (leaf.action === 'miku-settings') return window.petBridge.openMikuSettings();
      if (leaf.action === 'miku-appearance') return window.petBridge.setMikuAppearance(leaf.value).catch(error => console.error(error));
      if (leaf.action === 'miku-quit') return window.petBridge.quitMiku();
    }`);
patch('runtime/electron-helper/sprite/menu.js',"    if (leaf.action === 'open-site') {", `    if (this.assetRoot === 'miku') {
      if (leaf.action === 'miku-codex-quota') return this.showMikuCodexQuota();
      if (leaf.action === 'miku-whisper') return this.sayMikuWhisper();
      if (leaf.action === 'miku-whisper-interval') return this.setMikuWhisperInterval(leaf.value);
    }
    if (leaf.action === 'open-site') {`);

// Request a line without publishing it. The desktop decides whether it is still
// a good time to show the response and can fall back without duplicating a bubble.
patch('lib/app.js','const r = await publishWhisper(who.petId, url.searchParams.get("image") ?? void 0, want === null ? void 0 : voiceTargetOfSurface(want));',
  `const delivery = url.searchParams.get("delivery");
      const mikuDelivery = who.petId === "miku" && (delivery === "miku" || delivery === "miku-auto");
      const r = await publishWhisper(who.petId, mikuDelivery ? void 0 : url.searchParams.get("image") ?? void 0,
        want === null ? void 0 : voiceTargetOfSurface(want), mikuDelivery ? delivery : "manual",
        mikuDelivery && url.searchParams.get("appearance") === "symphony");`);
patch('lib/app.js','const chatMemory = createChatMemory({', 'const chatMemory = createChatMemory({\n        standaloneAiPolicy,');
patch('lib/app.js','const publishWhisper = async (petId, image, voiceTo, kind = "manual") => {',
  `const publishWhisper = async (petId, image, voiceTo, kind = "manual", symphony = false) => {
    if (kind === "miku" || kind === "miku-auto") {
      const ai = deps.standaloneAiPolicy();
      if (!ai?.isReady() || (kind === "miku-auto" && !ai.canWhisper())) return {ok:false, reason:"provider-missing"};
      return generateWhisper(ctx, {
        system: (symphony
          ? "你是《初音未来交响乐2020》Q版初音未来桌宠，穿白金裙，戴金色发夹。话题可选乐谱、八音盒、排练和休息。"
          : "你是《未来有你2021》Q版初音未来桌宠，撑纸伞，戴白花帽。话题可选天气、音乐、休息、花和小零食。")
          + "用自然温柔的简体中文随口说一句。只写一句 10 至 35 字的台词，不加引号、标题、舞台指示或对用户状态的臆测。",
        timeoutMs: 6500,
      });
    }`);
patch('lib/app.js','const deadline = AbortSignal.timeout(TIMEOUT_MS);','const deadline = AbortSignal.timeout(request.timeoutMs ?? TIMEOUT_MS);');
patch('lib/app.js','max_tokens: settings.maxTokens,\n\t\t\tn: 1',
  `max_tokens: settings.maxTokens,
      ...(new URL(settings.baseUrl).origin === 'https://api.deepseek.com' && settings.model === 'deepseek-flash'
        ? { thinking: { type: 'disabled' } } : {}),
      n: 1`);
patch('lib/app.js','type="checkbox">启用 AI 对话</label>','type="checkbox">启用碎碎念模型</label>');
patch('lib/app.js','aria-describedby="cost">开启自动碎碎念</label>','aria-describedby="cost">允许定时碎碎念调用模型</label>');
patch('lib/app.js','开启后，桌宠会按设定间隔定时调用模型并在桌面上说话冒泡（产生 API 费用）。默认关闭；右键菜单中的手动对话与手动碎碎念不受此开关限制。',
  '播放频率由桌宠右键菜单设置。允许后，定时碎碎念也会尝试调用模型，可能产生 API 费用。此项默认关闭，定时台词可继续离线播放。');
patch('lib/app.js','<div><label for="whisperIntervalSec">碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="60" max="86400" step="1" value="300" required></div>',
  '<input id="whisperIntervalSec" type="hidden" value="300">');
patch('lib/app.js','间隔至少 60 秒，默认 300 秒。输出上限越小，单次回复越简短。','输出上限越小，单次回复越简短。');

// Keep the upstream fixture compatible with its lost-button recovery and current
// input-region contract. A synthetic mousemove must carry the held button.
const smokeFile=join(dest,'runtime/electron-helper/main/smoke.js');
let smoke=readFileSync(smokeFile,'utf8');
for(const event of ['pointerdown','pointermove','mousemove'])smoke=smoke.replaceAll(`'${event}', {`, `'${event}', { buttons: 1,`);
writeFileSync(smokeFile,smoke);
// Compare the release position with the last position immediately before
// pointerup, not a sample taken 200 ms earlier while the spring can still move.
patch('runtime/electron-helper/main/smoke.js',
  '            var during = { x: d.dragPos.x, y: d.dragPos.y };\n            await sleep(200); // 轨迹过期 → 估速 null → 温柔放下（不抛掷）',
  '            await sleep(200); // 轨迹过期 → 估速 null → 温柔放下（不抛掷）\n            var during = { x: d.dragPos.x, y: d.dragPos.y };');
patch('runtime/electron-helper/main/smoke.js','hasBridge: typeof window.petBridge',`mikuPlayback: await (${readFileSync(join(root,'tools/dsh/renderer-check.js'),'utf8')})(${JSON.stringify(activeClips.map(({target,frames,clickAction,quotaTier})=>({target,frames,clickAction,quotaTier})))}),\n          hasBridge: typeof window.petBridge`);
patch('runtime/electron-helper/main/smoke.js','setPointerFallbackPaused(true);',`setPointerFallbackPaused(true);\n        await first.webContents.executeJavaScript('sprites[0].closeMenu(); true;');\n        await new Promise(r => setTimeout(r, 100));`);
patch('runtime/electron-helper/main/smoke.js',"const image = await first.webContents.capturePage();",`const passed=dump.mikuPlayback.passed && dump.debug.configOk && !dump.errorVisible && dump.debug.errors.length===0 && dump.releaseKeptPosition.kept && dump.interactiveFlip.inside && dump.interactiveFlip.outside && dump.interactiveFlip.duringDragForced && interactiveIgnoring===false && passthroughIgnoring===true;\n        writeFileSync(smokeOut+'.json',JSON.stringify({passed,dump,interactiveIgnoring,passthroughIgnoring},null,2));\n        const image = await first.webContents.capturePage();`);

const animations={
  idle:['待机眨眼'],turn:['左右张望'],drag:['悬空轻晃'],clicks:['开心回应','害羞一下',...clickActions],
  moves:{default:{minDist:48,maxDist:120,margin:20,leadSec:.5,tailSec:1.34},actions:[{name:'散步一下'}]},
  categories:[
    {id:'打招呼',weight:4,noMirror:true,actions:['挥挥手','打个招呼','撑伞致意']},
    {id:'小动作',weight:2,noMirror:true,actions:['左右张望','整理帽子']},
    {id:'开心时光',weight:1,noMirror:true,actions:['轻快舞步','开心摇摆']},
    {id:'动作查看',weight:0,noMirror:true,actions:['提起晃腿','落地站稳']}
  ],events:{balance:['待机眨眼']},sleep:[{start:['打个盹'],loop:['睡梦中'],end:['慢慢醒来']}]
};
buildActionCatalog(root, join(dest, 'runtime/electron-helper'), activeClips, [
  { label: '日常', names: [...animations.idle, ...animations.clicks, ...animations.turn, '整理帽子'] },
  ...animations.categories.filter(({ id }) => ['打招呼', '开心时光'].includes(id))
    .map(({ id, actions }) => ({ label: id, names: actions })),
  { label: '生活趣味', names: lifeActions },
  { label: '额度动作', names: Object.values(quotaVideos) },
  { label: '移动与拖拽', names: [...animations.moves.actions.map(({name}) => name),
    ...menuOnlyActions, ...animations.categories.find(({id}) => id === '动作查看').actions, ...animations.drag] },
  { label: '睡眠', names: animations.sleep.flatMap(({start, loop, end}) => [...start, ...loop, ...end]) },
]);
buildActionCatalog(root, join(dest, 'runtime/electron-helper'), symphonyClips, symphonyGroups, 'miku-symphony-catalog.json');
const size=+(640*(360*.78*Number(setting('SizePercent','70'))/100)/300).toFixed(2);
const pet={id:'miku',name:'Miku · 未来有你2021',size,balanceEnabled:false,whisperEnabled:false,workStatusEnabled:false,fixedEnabled:setting('WanderEnabled','false')!=='true',display:'desktop',position:{corner:'top-left',marginX:+(Number(setting('Left','1300'))+300*.78*Number(setting('SizePercent','70'))/200-size/2).toFixed(2),marginY:+(Number(setting('Top','550'))+65*.78*Number(setting('SizePercent','70'))/100-size*60/640).toFixed(2)}};
const conf={pets:[pet],animations,animationWeights:{idle:88,turn:3,move:3},font:{family:'system',size:18,followPet:true},physics:{gravity:1400,restitution:.55,groundFriction:3,ceilingBounce:true,throwPower:.65,petCollision:false,hapticEnabled:false,tiltGravity:false,shakeThrow:false},confineToScreen:true,sleepStartTexts:['稍微休息一下，待会儿见 ♪'],sleepEndTexts:['醒来啦，继续陪你 ♪'],sleepRefuseTexts:['让我再睡一会儿嘛…']};
writeFileSync(join(pack,'miku-config.json'),JSON.stringify(conf,null,2)+'\n');
mkdirSync(join(data,'dsh-pet/pet'),{recursive:true});
const main={pets:[{...pet,id:'main',name:'默认角色（隐藏）',display:'none'}],animations,animationWeights:conf.animationWeights,clickSoundEnabled:false,notificationsEnabled:false,voiceEnabled:false,voiceWhisperEnabled:false,voiceTodoEnabled:false,whisperImageEnabled:false,chatImageEnabled:false,chatAnimationEnabled:false,font:conf.font,physics:conf.physics,confineToScreen:true};
if(!existsSync(join(data,'dsh-pet/main-config.jsonc')))writeFileSync(join(data,'dsh-pet/main-config.jsonc'),JSON.stringify(main,null,2));
if(!existsSync(join(data,'dsh-pet/pet/miku-config.json')))cpSync(join(pack,'miku-config.json'),join(data,'dsh-pet/pet/miku-config.json'));
const installedAnimations=join(data,'dsh-pet/pet/miku-animation');
mkdirSync(installedAnimations,{recursive:true});
for(const clip of [...activeClips, ...symphonyClips])cpSync(clip.source,join(installedAnimations,clip.target+'.webm'));
// Older builds shipped the front pose as an additional idle in this generated directory.
const retiredFrontIdle=join(installedAnimations,'正面站姿待机.webm');
if(existsSync(retiredFrontIdle))unlinkSync(retiredFrontIdle);
writeFileSync(join(dest,'bootstrap.cjs'),`const {app}=require('electron');\nconst path=require('node:path');\nprocess.env.DSH_HOME=path.resolve(__dirname,'../../../data-dsh');\nrequire('node:fs').mkdirSync(path.join(process.env.DSH_HOME,'chromium'),{recursive:true});\napp.setName('Miku Video Pet');\napp.setPath('userData',path.join(process.env.DSH_HOME,'chromium'));\nif(process.argv.includes('--miku-smoke')){process.env.DSH_PET_SMOKE='1';process.env.DSH_PET_SMOKE_OUT=path.join(process.env.DSH_HOME,'smoke.png');}\nimport('./lib/app.js');\n`);
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim();
writeFileSync(join(root,'integrations/dsh/upstream.json'),JSON.stringify({repository:'https://github.com/PC2005-cloud/dsh-pet',commit,adapter:'tools/dsh/build-trial.mjs',assetOrigin:'Reviewed Miku videos; no upstream character videos included.'},null,2)+'\n');
console.log('Miku pack and runtime adapter built: '+dest);
