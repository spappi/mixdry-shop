const { contextBridge, ipcRenderer, webFrame, clipboard } = require('electron');

contextBridge.exposeInMainWorld('api', {
    analyzeSite: (config) => ipcRenderer.invoke('analyze-site', config),
    extractFrontend: (config) => ipcRenderer.invoke('extract-frontend', config),
    crawlLinks: (config) => ipcRenderer.invoke('crawl-links', config),
    extractMulti: (config) => ipcRenderer.invoke('extract-multi', config),
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
    copyToClipboard: (text) => clipboard.writeText(text),
    
    // v4.3 Clone Library IPCs
    listClones: () => ipcRenderer.invoke('list-clones'),
    loadClone: (dir) => ipcRenderer.invoke('load-clone', dir),
    repairClone: (dir, revive) => ipcRenderer.invoke('repair-clone', dir, revive),
    deleteClone: (dir) => ipcRenderer.invoke('delete-clone', dir),
    importClone: () => ipcRenderer.invoke('import-clone'),
    openCloneFolder: (dir) => ipcRenderer.invoke('open-clone-folder', dir),
    getLibraryPath: () => ipcRenderer.invoke('get-library-path'),
    setLibraryPath: (path) => ipcRenderer.invoke('set-library-path', path),
    
    cancelOperation: () => ipcRenderer.invoke('cancel-operation')
});