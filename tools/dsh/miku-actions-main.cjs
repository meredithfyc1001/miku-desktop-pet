'use strict';
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow } = require('electron');
const { loadPreferences, savePreferences } = require('./miku-preferences.cjs');

function registerActions({ ipcMain, petWindows }) {
  const home = process.env.DSH_HOME;
  const catalogs = {
    classic: require('./miku-action-catalog.json'),
    symphony: require('./miku-symphony-catalog.json'),
  };
  const currentAppearance = () => loadPreferences(home).appearance ?? 'classic';
  const currentCatalog = () => catalogs[currentAppearance()];
  const hasAction = name => currentCatalog().some(action => action.name === name);
  let window;
  let requestId = 0;
  const pending = new Map();
  const pets = () => [...petWindows.state.windows.values()].filter(win => !win.isDestroyed());
  const owns = (event, win) => win?.webContents === event.sender && event.senderFrame === event.sender.mainFrame;
  const favorites = () => [...new Set(loadPreferences(home).favorites ?? [])];

  function open() {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      title: 'Miku · 动作图鉴', width: 1100, height: 790, minWidth: 560, minHeight: 520,
      show: false, backgroundColor: '#101b22', autoHideMenuBar: true,
      icon: join(__dirname, 'miku-settings-art.png'),
      webPreferences: {
        preload: join(__dirname, 'miku-actions-preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => { window = undefined; });
    void window.loadFile(join(__dirname, 'miku-actions.html'));
  }

  ipcMain.on('miku:actions:open', event => { if (pets().some(pet => owns(event, pet))) open(); });
  ipcMain.handle('miku:appearance', (event, appearance) => {
    if (!pets().some(pet => owns(event, pet)) || typeof appearance !== 'string' ||
        !Object.hasOwn(catalogs, appearance)) return false;
    if (currentAppearance() === appearance) return true;
    savePreferences(home, { appearance });
    if (window && !window.isDestroyed()) window.close();
    for (const pet of pets()) pet.webContents.send('miku:preferences:changed', ['appearance']);
    return true;
  });
  ipcMain.handle('miku:actions:list', event => owns(event, window) ? {
    catalog: currentCatalog().map(action => ({
      ...action,
      video: pathToFileURL(join(home, 'dsh-pet/pet/miku-animation', action.name + '.webm')).href,
    })),
    appearance: currentAppearance(),
    favorites: favorites().filter(hasAction),
  } : null);
  ipcMain.handle('miku:actions:favorite', (event, name, enabled) => {
    if (!owns(event, window) || !hasAction(name) || typeof enabled !== 'boolean') return null;
    const next = new Set(favorites());
    if (enabled) next.add(name);
    else next.delete(name);
    const { favorites: saved } = savePreferences(home, { favorites: [...next] });
    for (const pet of pets()) pet.webContents.send('miku:favorites:changed', saved);
    return saved.filter(hasAction);
  });
  ipcMain.handle('miku:actions:play', (event, name) => {
    if (!owns(event, window) || !hasAction(name)) return 'unavailable';
    const [pet] = pets();
    if (!pet) return 'hidden';
    const id = ++requestId;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve('unavailable');
      }, 1500);
      pending.set(id, { pet, finish: result => { clearTimeout(timer); resolve(result); } });
      pet.webContents.send('miku:actions:play', id, name);
    });
  });
  ipcMain.on('miku:actions:played', (event, id, result) => {
    const request = pending.get(id);
    if (!request || request.pet.isDestroyed() || !owns(event, request.pet)) return;
    pending.delete(id);
    request.finish(result === true ? 'playing' : 'busy');
  });
  return open;
}

module.exports = { registerActions };
