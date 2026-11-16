'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mikuSettings', {
  read: () => ipcRenderer.invoke('miku:settings:read'),
  save: changes => ipcRenderer.invoke('miku:settings:save', changes),
  model: () => ipcRenderer.invoke('miku:settings:model'),
});
