'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guardnetDesktop', {
  info: () => ipcRenderer.invoke('gn:info'),
});