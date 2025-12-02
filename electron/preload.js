const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  startVirtualCam: () => ipcRenderer.invoke('start-virtual-cam'),
  stopVirtualCam: () => ipcRenderer.invoke('stop-virtual-cam'),
  sendFrame: (frameData) => ipcRenderer.send('virtual-cam-frame', frameData),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (event, userData) => callback(userData)),
  // Settings API
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings)
});
