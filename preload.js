const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerAPI', {
  schedule: (seconds, action) => ipcRenderer.invoke('schedule', seconds, action),
  cancel: () => ipcRenderer.invoke('cancel'),
  interrupt: (names, force) => ipcRenderer.invoke('interrupt', { names, force: !!force }),
  setRunning: (value) => ipcRenderer.send('set-running', value),
  setTrayTooltip: (text) => ipcRenderer.send('tray-tooltip', text),
  setProgress: (value) => ipcRenderer.send('set-progress', value),
  syncScheduledTasks: (active) => ipcRenderer.send('sync-scheduled-tasks', !!active),
  onMenuCancel: (cb) => ipcRenderer.on('menu-cancel', () => cb()),
  minimize: () => ipcRenderer.send('win-minimize'),
  close: () => ipcRenderer.send('win-close'),
});
