const { contextBridge, ipcRenderer, webFrame, clipboard } = require('electron');

contextBridge.exposeInMainWorld('api', {
    extractFrontend: (config) => ipcRenderer.invoke('extract-frontend', config),
    scaffoldBackend: (config) => ipcRenderer.invoke('scaffold-backend', config),
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    onLog: (callback) => ipcRenderer.on('log', (event, msg, type) => callback(msg, type)),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
    openClone: (folderPath) => ipcRenderer.invoke('open-clone', folderPath),
    
    // v3 additions
    getDbPath: () => ipcRenderer.invoke('get-db-path'),
    initDb: (dbPath) => ipcRenderer.invoke('init-db', dbPath),
    savePattern: (data) => ipcRenderer.invoke('save-pattern', data),
    getPatterns: (filters) => ipcRenderer.invoke('get-patterns', filters),
    deletePattern: (id) => ipcRenderer.invoke('delete-pattern', id),
    updatePatternTags: (id, tags) => ipcRenderer.invoke('update-pattern-tags', id, tags),
    searchPatterns: (keywords) => ipcRenderer.invoke('search-patterns', keywords),
    copyToClipboard: (text) => clipboard.writeText(text)
});