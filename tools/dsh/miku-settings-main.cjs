'use strict';
const { join } = require('node:path');
const { BrowserWindow } = require('electron');
const { loadPreferences, savePreferences, effectivePreferences } = require('./miku-preferences.cjs');

function registerSettings({ ipcMain, petWindows, shell, hostRequest, petRoute, topmostLevel, onPreferencesSaved }) {
  const home = process.env.DSH_HOME;
  let window;
  function open() {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      title: 'Miku · 桌宠设置', width: 1050, height: 790, minWidth: 520, minHeight: 520,
      show: false, backgroundColor: '#0d171e', autoHideMenuBar: true,
      icon: join(__dirname, 'miku-settings-art.png'),
      webPreferences: {
        preload: join(__dirname, 'miku-settings-preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => { window = undefined; });
    void window.loadFile(join(__dirname, 'miku-settings.html'));
  }
  const ownsPet = event => event.senderFrame === event.sender.mainFrame &&
    [...petWindows.state.windows.values()].some(win => win.webContents === event.sender);
  const ownsSettings = event => window?.webContents === event.sender && event.senderFrame === event.sender.mainFrame;
  async function readEffective() {
    const reply = await hostRequest('GET', petRoute + '/config');
    return effectivePreferences(JSON.parse(reply.body), loadPreferences(home), process.env.MIKU_TOPMOST !== 'false');
  }
  ipcMain.on('miku:settings:open', event => { if (ownsPet(event)) open(); });
  ipcMain.handle('miku:preferences', event => ownsPet(event) ? loadPreferences(home) : {});
  ipcMain.handle('miku:preferences:whisper', (event, minutes) => {
    if (ownsPet(event)) savePreferences(home, { whisper: minutes });
  });
  ipcMain.handle('miku:settings:read', async event => {
    if (!ownsSettings(event)) return null;
    const prefs = await readEffective();
    const pet = [...petWindows.state.windows.values()].find(win => !win.isDestroyed());
    if (prefs.whisper === null && pet) {
      const minutes = await pet.webContents.executeJavaScript('Number(localStorage.getItem("miku.whisperMinutes"))').catch(() => 0);
      prefs.whisper = [0, 5, 15, 30].includes(minutes) ? minutes : 0;
    }
    return prefs;
  });
  ipcMain.handle('miku:settings:save', async (event, changes) => {
    if (!ownsSettings(event)) return { ok: false };
    try {
      const prefs = savePreferences(home, changes, await readEffective());
      onPreferencesSaved?.(prefs);
      if (typeof prefs.topmost === 'boolean') process.env.MIKU_TOPMOST = String(prefs.topmost);
      for (const win of petWindows.state.windows.values()) {
        if (win.isDestroyed()) continue;
        win.setAlwaysOnTop(process.env.MIKU_TOPMOST !== 'false', topmostLevel(process.platform));
        win.webContents.send('miku:preferences:changed', Object.keys(changes));
      }
      return { ok: true };
    } catch {
      return { ok: false, message: '保存失败，请检查选项范围或稍后再试。' };
    }
  });
  ipcMain.handle('miku:settings:model', async event => {
    if (!ownsSettings(event) || !process.env.DSH_PET_SITE_URL) return false;
    await shell.openExternal(process.env.DSH_PET_SITE_URL);
    return true;
  });
  return open;
}

module.exports = { registerSettings };
