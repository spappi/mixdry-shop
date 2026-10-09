const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    extractFrontend: (url) => ipcRenderer.invoke('extract-frontend', url),
    scaffoldBackend: (config) => ipcRenderer.invoke('scaffold-backend', config)
});
