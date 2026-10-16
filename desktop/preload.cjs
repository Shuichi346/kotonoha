const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kotonoha', {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  status: () => ipcRenderer.invoke('app:status'),
  settings: (value) => ipcRenderer.invoke('app:settings', value),
  start: () => ipcRenderer.invoke('app:start'),
  stop: () => ipcRenderer.invoke('app:stop'),
  overlay: (value) => ipcRenderer.invoke('app:overlay', value),
  lock: (value) => ipcRenderer.invoke('app:lock', value),
  showController: () => ipcRenderer.invoke('app:controller'),
  hideController: () => ipcRenderer.invoke('app:hide'),
  export: (format) => ipcRenderer.invoke('app:export', format),
  subscribe: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('live:event', listener);
    return () => ipcRenderer.removeListener('live:event', listener);
  }
});
