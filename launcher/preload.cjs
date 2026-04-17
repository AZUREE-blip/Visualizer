const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  initProject: (path) => ipcRenderer.invoke('init-project', path),
  analyzeProject: (path) => ipcRenderer.invoke('analyze-project', path),
  saveApiKey: (data) => ipcRenderer.invoke('save-api-key', data),
  startVisualizer: (path) => ipcRenderer.invoke('start-visualizer', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
