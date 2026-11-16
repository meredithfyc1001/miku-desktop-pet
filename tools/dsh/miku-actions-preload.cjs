'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mikuActions', {
  list: () => ipcRenderer.invoke('miku:actions:list'),
  favorite: (name, enabled) => ipcRenderer.invoke('miku:actions:favorite', name, enabled),
  play: name => ipcRenderer.invoke('miku:actions:play', name),
});
