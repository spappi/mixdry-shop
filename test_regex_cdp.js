const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false });
    await win.loadURL('https://www.t-print.co.kr/');
    
    win.webContents.debugger.attach('1.3');
    
    const script = `
        (() => {
            const text = 'background-image: url("test.png");';
            const matches1 = text.match(/url\\(['"]?(.*?)['"]?\\)/g);
            return matches1;
        })()
    `;
    
    const evalRes = await win.webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: script,
        returnByValue: true
    });
    
    console.log("Result:", evalRes.result.value);
    app.quit();
});
