const { app, ipcMain, BrowserWindow } = require('electron');
require('./main');

app.on('ready', async () => {
    setTimeout(async () => {
        try {
            const win = BrowserWindow.getAllWindows()[0];
            const sender = win.webContents;
            
            sender.send = (channel, ...args) => {
                if (channel === 'log' || channel === 'extract-progress') {
                    console.log(channel, ...args);
                }
            };

            const event = { sender };
            
            console.log('--- CRAWLING ---');
            // We can invoke the handlers by sending an event to them if we know how,
            // but for IPC handlers we can directly emit to ipcMain
            // Wait, ipcMain.handle registers handlers. To call it:
            // We can use a trick: bypass crawl-links and just supply links to extract-multi
            
            const links = [
                'http://www.t-print.co.kr/',
                'http://www.t-print.co.kr/pages/goods_list_php_cate_code_26010000_mode_POD.html'
            ];
            
            // extract-multi uses ipcMain.on
            console.log('--- EXTRACTING ---');
            ipcMain.emit('extract-multi', event, {
                urls: links,
                delayMs: 1000
            });
            
            // We'll need to wait for it to finish.
            // We'll monitor the logs to exit.
            const oldSend = sender.send;
            sender.send = (c, ...args) => {
                oldSend(c, ...args);
                if (c === 'log' && args[0].includes('[추출 완료]')) {
                    console.log('DONE!');
                    app.quit();
                }
            };
        } catch(e) {
            console.error(e);
            app.quit();
        }
    }, 2000);
});
