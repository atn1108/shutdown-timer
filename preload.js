const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerAPI', {
  schedule: (seconds) => ipcRenderer.invoke('schedule', seconds),
  cancel: () => ipcRenderer.invoke('cancel'),
  interrupt: (names, force) => ipcRenderer.invoke('interrupt', { names, force: !!force }),
  setRunning: (value) => ipcRenderer.send('set-running', value),
  minimize: () => ipcRenderer.send('win-minimize'),
  close: () => ipcRenderer.send('win-close'),
});
