// 화면(렌더러)에 노출하는 안전한 기능들
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('amg', {
  platform: process.platform,
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  writeFile: (file, data) => ipcRenderer.invoke('fs:write', file, data),
  showInFolder: (file) => ipcRenderer.invoke('shell:show', file),
  setDirty: (v) => ipcRenderer.send('app:set-dirty', v),
  closeNow: () => ipcRenderer.send('app:close-now'),
  onSaveAndClose: (cb) => {
    const h = () => cb();
    ipcRenderer.on('app:save-and-close', h);
    return () => ipcRenderer.removeListener('app:save-and-close', h);
  },
  onOpenFile: (cb) => {
    const h = (_e, f) => cb(f);
    ipcRenderer.on('app:open-file', h);
    return () => ipcRenderer.removeListener('app:open-file', h);
  },
  video: {
    start: (opts) => ipcRenderer.invoke('video:start', opts),
    frame: (id, data) => ipcRenderer.invoke('video:frame', id, data),
    finish: (id) => ipcRenderer.invoke('video:finish', id),
    cancel: (id) => ipcRenderer.invoke('video:cancel', id),
  },
});
