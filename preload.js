const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
    extractFrontend: (url) => ipcRenderer.invoke('extract-frontend', url),
    scaffoldBackend: (config) => ipcRenderer.invoke('scaffold-backend', config),
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    onLog: (callback) => ipcRenderer.on('log', (event, msg, type) => callback(msg, type))
});