const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

require('./main.js');

app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false }});
    const html = `<html><body>
        <script>
            const { ipcRenderer } = require("electron");
            ipcRenderer.invoke("extract-multi", { 
                urls: [{ url: "https://www.t-print.co.kr/" }], 
                outDirBase: "D:/FREE-GJC/tmp_test", 
                paramBlacklist: ["timeKey"] 
            }).then(res => ipcRenderer.send("test-done", res)).catch(e => ipcRenderer.send("test-error", e.message));
        </script>
    </body></html>`;
    win.loadURL('data:text/html,' + encodeURIComponent(html));

    ipcMain.on('test-done', (e, res) => {
        console.log('Result Assets:', res.data.assets.filter(a => a.includes('css') || a.includes('img')));
        app.quit();
    });
    
    ipcMain.on('test-error', (e, err) => {
        console.log('Error:', err);
        app.quit();
    });
});
