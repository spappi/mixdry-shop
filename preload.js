const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
    extractFrontend: (config) => ipcRenderer.invoke('extract-frontend', config),
    scaffoldBackend: (config) => ipcRenderer.invoke('scaffold-backend', config),
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    onLog: (callback) => ipcRenderer.on('log', (event, msg, type) => callback(msg, type)),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath)
});