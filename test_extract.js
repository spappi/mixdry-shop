const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

require('./main.js');

app.whenReady().then(() => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadURL('data:text/html,<html><body><script>const { ipcRenderer } = require("electron"); ipcRenderer.invoke("extract-multi", { urls: [{ url: "https://www.t-print.co.kr/" }, { url: "https://www.t-print.co.kr/ORDER/goods_list.php?mode=POD&cate_code=26010000" }], outDirBase: "D:/FREE-GJC/output", paramBlacklist: ["timeKey"] }).then(res => ipcRenderer.send("test-done", res)).catch(e => ipcRenderer.send("test-error", e.message));</script></body></html>');

    ipcMain.on('test-done', (e, res) => {
        console.log('Result:', res);
        app.quit();
    });
    
    ipcMain.on('test-error', (e, err) => {
        console.log('Error:', err);
        app.quit();
    });
});
