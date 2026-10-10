const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let mainWindow;
let patternDb = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 850,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// v3: DB Initialization
ipcMain.handle('init-db', async (event, customPath) => {
    try {
        const dbPath = customPath || path.join(app.getPath('userData'), 'patterns.db');
        patternDb = new Database(dbPath);
        
        patternDb.exec(`
            CREATE TABLE IF NOT EXISTS sites (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              url TEXT NOT NULL,
              domain TEXT NOT NULL,
              title TEXT,
              captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              clone_dir TEXT,
              screenshot_path TEXT
            );
            CREATE TABLE IF NOT EXISTS patterns (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
              category TEXT NOT NULL,
              name TEXT NOT NULL,
              summary TEXT NOT NULL,
              tags TEXT,
              content_json TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        return { success: true, message: `패턴 DB 연결 성공 (${dbPath})` };
    } catch(e) {
        return { success: false, message: e.message };
    }
});

// v3: Pattern DB CRUD
ipcMain.handle('save-pattern', async (event, data) => {
    if(!patternDb) return {success:false, message: 'DB not initialized'};
    try {
        const siteStmt = patternDb.prepare('INSERT INTO sites (url, domain, clone_dir) VALUES (?, ?, ?)');
        const info = siteStmt.run(data.url, data.domain, data.cloneDir);
        const siteId = info.lastInsertRowid;
        
        const patStmt = patternDb.prepare('INSERT INTO patterns (site_id, category, name, summary, tags, content_json) VALUES (?, ?, ?, ?, ?, ?)');
        const insertMany = patternDb.transaction((patterns) => {
            for (const p of patterns) patStmt.run(siteId, p.category, p.name, p.summary, p.tags, p.content_json);
        });
        insertMany(data.patterns);
        
        return {success: true, siteId};
    } catch(e) { return {success: false, message: e.message}; }
});

ipcMain.handle('get-patterns', async (event, keyword) => {
    if(!patternDb) return {success:false, message: 'DB not initialized'};
    try {
        let query = `SELECT p.*, s.domain, s.url FROM patterns p JOIN sites s ON p.site_id = s.id ORDER BY p.created_at DESC`;
        let patterns = [];
        if (keyword && keyword.trim()) {
            const kw = `%${keyword.trim()}%`;
            query = `SELECT p.*, s.domain, s.url FROM patterns p JOIN sites s ON p.site_id = s.id WHERE p.tags LIKE ? OR p.name LIKE ? OR s.domain LIKE ? ORDER BY p.created_at DESC`;
            patterns = patternDb.prepare(query).all(kw, kw, kw);
        } else {
            patterns = patternDb.prepare(query).all();
        }
        return {success: true, data: patterns};
    } catch(e) { return {success: false, message: e.message}; }
});

ipcMain.handle('search-patterns', async (event, prompt) => {
    if(!patternDb) return {success:false, message: 'DB not initialized'};
    try {
        const keywords = prompt.split(/\s+/).filter(w => w.length > 1);
        if (keywords.length === 0) return {success: true, data: []};
        
        const conditions = [];
        const params = [];
        for (const kw of keywords) {
            conditions.push('(p.tags LIKE ? OR p.name LIKE ? OR p.summary LIKE ?)');
            params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
        }
        
        const query = `SELECT p.*, s.domain FROM patterns p JOIN sites s ON p.site_id = s.id WHERE ${conditions.join(' OR ')}`;
        const results = patternDb.prepare(query).all(...params);
        
        // Rank results
        results.forEach(r => {
            r._score = 0;
            const tags = (r.tags||'').split(',').map(t=>t.trim());
            keywords.forEach(kw => {
                if(tags.includes(kw)) r._score += 10;
                else if(r.tags && r.tags.includes(kw)) r._score += 5;
                if(r.name.includes(kw)) r._score += 3;
                if(r.summary.includes(kw)) r._score += 1;
            });
        });
        results.sort((a,b) => b._score - a._score);
        
        // Return top 3 matches to keep context window manageable
        return {success: true, data: results.slice(0, 3)};
    } catch(e) { return {success: false, message: e.message}; }
});

ipcMain.handle('delete-pattern', async (event, id) => {
    if(!patternDb) return {success:false, message: 'DB not initialized'};
    try {
        patternDb.prepare('DELETE FROM patterns WHERE id = ?').run(id);
        return {success: true};
    } catch(e) { return {success: false, message: e.message}; }
});


ipcMain.handle('open-folder', async (event, folderPath) => {
    shell.showItemInFolder(folderPath);
});

ipcMain.handle('open-clone', async (event, folderPath) => {
    shell.openPath(path.join(folderPath, 'index.html'));
});

// v3.2: Extraction logic with Chrome DevTools Protocol (CDP)
ipcMain.handle('extract-frontend', async (event, config) => {
    const { url, outDirBase } = config;
    let offscreenWindow = null;
    let debuggerAttached = false;
    const sendLog = (msg, type='info') => event.sender.send('log', msg, type);
    
    try {
        const domain = new URL(url).hostname;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outDir = path.join(outDirBase, `clone_${domain}_${timestamp}`);
        
        fs.mkdirSync(path.join(outDir, 'css'), { recursive: true });
        fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

        sendLog('오프스크린 브라우저 초기화 중...');
        offscreenWindow = new BrowserWindow({
            show: false,
            webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
        });

        const capturedBodies = new Map();
        const reqOriginalUrl = new Map();
        const reqFinalUrl = new Map();

        let debuggerSetupPromise = null;

        // 1. 타겟 준비 완료(네비게이션 시작) 시점에 디버거 부착
        offscreenWindow.webContents.once('did-start-loading', () => {
            debuggerSetupPromise = (async () => {
                try {
                    if (offscreenWindow.webContents.debugger.isAttached()) {
                        offscreenWindow.webContents.debugger.detach();
                    }
                    offscreenWindow.webContents.debugger.attach('1.3');
                    
                    const enableCmd = offscreenWindow.webContents.debugger.sendCommand('Network.enable');
                    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('CDP Network.enable 타임아웃 (10초)')), 10000));
                    
                    // 2. Promise.race로 타임아웃 감싸기
                    await Promise.race([enableCmd, timeout]);
                    
                    debuggerAttached = true;
                    sendLog('디버거 부착 완료 (에셋 자동 캡처 모드)');
                    
                    offscreenWindow.webContents.debugger.on('message', async (e, method, params) => {
                        try {
                            if (method === 'Network.requestWillBeSent') {
                                reqOriginalUrl.set(params.requestId, params.request.url);
                            } else if (method === 'Network.responseReceived') {
                                reqFinalUrl.set(params.requestId, params.response.url);
                            } else if (method === 'Network.loadingFinished') {
                                const requestId = params.requestId;
                                const urls = [reqOriginalUrl.get(requestId), reqFinalUrl.get(requestId)].filter(Boolean);
                                try {
                                    const { body, base64Encoded } = await offscreenWindow.webContents.debugger.sendCommand(
                                        'Network.getResponseBody', { requestId }
                                    );
                                    const buf = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
                                    for (const u of urls) capturedBodies.set(u, buf);
                                } catch (err) {
                                    // 무시
                                }
                                reqOriginalUrl.delete(requestId);
                                reqFinalUrl.delete(requestId);
                            }
                        } catch (err) {}
                    });
                } catch (e) {
                    sendLog('디버거 부착 실패, 폴백 모드로 진행: ' + e.message, 'error');
                    try {
                        if (offscreenWindow.webContents.debugger.isAttached()) {
                            offscreenWindow.webContents.debugger.detach();
                        }
                    } catch(err) {}
                }
            })();
        });

        sendLog(`타겟 URL 로딩 시작: ${url}`);
        
        // 3. 로딩 시작
        const loadPromise = offscreenWindow.loadURL(url, { waitUntil: 'domcontentloaded' });
        
        // DOM 트리 로드 완료 대기
        await loadPromise;
        
        // 디버거 부착 프로미스가 등록되었다면 최종 결과(성공/타임아웃) 확인 대기
        if (debuggerSetupPromise) {
            await debuggerSetupPromise;
        }
        
        sendLog('추가 리소스 로딩 및 바디 캡처 대기 중 (3.5초)...');
        await new Promise(r => setTimeout(r, 3500));
        
        // 스크린샷 캡처
        sendLog('DOM 스냅샷 캡처 중...');
        const image = await offscreenWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'screenshot.png'), image.toPNG());

        sendLog('DOM 스냅샷 및 에셋 매핑 스크립트 실행 중...');
        const pageData = await offscreenWindow.webContents.executeJavaScript(`
            (() => {
                const colorMap = {};
                const spacingMap = {};
                const fonts = new Set();
                const sections = [];
                const components = [];
                
                document.querySelectorAll('*').forEach(el => {
                    const s = window.getComputedStyle(el);
                    
                    const bg = s.backgroundColor;
                    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colorMap[bg] = (colorMap[bg] || 0) + 1;
                    
                    const c = s.color;
                    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colorMap[c] = (colorMap[c] || 0) + 1;
                    
                    if (s.fontFamily) fonts.add(s.fontFamily.split(',')[0].replace(/['"]/g, '').trim());

                    ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom'].forEach(prop => {
                        if (s[prop] && s[prop] !== '0px') spacingMap[s[prop]] = (spacingMap[s[prop]] || 0) + 1;
                    });
                });
                
                const colors = Object.entries(colorMap).sort((a, b) => b[1] - a[1]).map(e => e[0]);
                const spacing = Object.entries(spacingMap).sort((a, b) => b[1] - a[1]).map(e => e[0]);
                    
                document.querySelectorAll('header, nav, main, section, article, aside, footer').forEach(el => {
                    sections.push({ tag: el.tagName.toLowerCase(), className: el.className });
                });
                
                document.querySelectorAll('button, input, textarea, select, table, form').forEach(el => {
                    components.push({ type: el.tagName.toLowerCase() });
                });

                document.querySelectorAll('script, iframe, noscript').forEach(s => s.remove());
                const iter = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT, null, false);
                let node;
                const comments = [];
                while(node = iter.nextNode()) comments.push(node);
                comments.forEach(c => c.remove());

                document.querySelectorAll('*').forEach(el => {
                    if(!el.attributes) return;
                    Array.from(el.attributes).forEach(attr => {
                        if(attr.name.startsWith('on')) el.removeAttribute(attr.name);
                    });
                });

                const assetUrls = [];
                let assetId = 0;

                document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
                    if (el.href && !el.href.startsWith('data:')) {
                        const localPath = 'css/style-' + (assetId++) + '.css';
                        assetUrls.push({ url: el.href, localPath, type: 'css' });
                        el.href = localPath;
                    }
                });

                document.querySelectorAll('img, source').forEach(el => {
                    if (el.src && !el.src.startsWith('data:')) {
                        const ext = el.src.split('.').pop().split('?')[0] || 'png';
                        const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                        const localPath = 'assets/img-' + (assetId++) + '.' + safeExt;
                        assetUrls.push({ url: el.src, localPath, type: 'asset' });
                        el.src = localPath;
                    }
                    if (el.srcset) el.removeAttribute('srcset');
                });

                document.querySelectorAll('style').forEach(el => {
                    const localPath = 'css/inline-' + (assetId++) + '.css';
                    assetUrls.push({ text: el.innerHTML, localPath, type: 'inline-css' });
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = localPath;
                    el.replaceWith(link);
                });

                return {
                    html: document.documentElement.outerHTML,
                    assetUrls,
                    tokens: { colors, fonts: Array.from(fonts), spacing },
                    layout: { sections },
                    components,
                    elementCount: document.querySelectorAll('*').length
                };
            })();
        `);

        sendLog('레이아웃 구조 및 에셋 매핑 완료...');
        fs.writeFileSync(path.join(outDir, 'index.html'), '<!DOCTYPE html>\n<html>\n' + pageData.html + '\n</html>');
        
        const failedAssets = [];
        const assets = [];

        if (debuggerAttached) {
            sendLog(`총 ${pageData.assetUrls.length}개 에셋/CSS 캡처 저장 시작... (네트워크 재요청 없음)`);
            for (const item of pageData.assetUrls) {
                try {
                    if (item.type === 'inline-css') {
                        fs.writeFileSync(path.join(outDir, item.localPath), item.text);
                    } else {
                        const buf = capturedBodies.get(item.url);
                        if (!buf) throw new Error('캡처된 바디 없음');
                        fs.writeFileSync(path.join(outDir, item.localPath), buf);
                    }
                    assets.push(item);
                    sendLog(`[캡처 저장] ${item.localPath}`);
                } catch (e) {
                    failedAssets.push({ url: item.url, error: e.message });
                    sendLog(`[캡처 실패] ${item.url} - ${e.message}`, 'error');
                }
            }
        } else {
            // 폴백 모드 (디버거 부착 실패 시 in-page fetch)
            sendLog(`총 ${pageData.assetUrls.length}개 에셋/CSS 폴백 다운로드 시작... (동시성 5 제한)`);
            async function processQueue(items, limit) {
                let i = 0;
                const exec = async () => {
                    while (i < items.length) {
                        const item = items[i++];
                        try {
                            if (item.type === 'inline-css') {
                                fs.writeFileSync(path.join(outDir, item.localPath), item.text);
                            } else {
                                const b64 = await offscreenWindow.webContents.executeJavaScript(`
                                    fetch("${item.url}")
                                        .then(res => {
                                            if (!res.ok) throw new Error(res.statusText);
                                            return res.arrayBuffer();
                                        })
                                        .then(buffer => {
                                            const bytes = new Uint8Array(buffer);
                                            let binary = '';
                                            const len = bytes.byteLength;
                                            for (let i = 0; i < len; i += 32768) {
                                                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
                                            }
                                            return btoa(binary);
                                        })
                                `);
                                fs.writeFileSync(path.join(outDir, item.localPath), Buffer.from(b64, 'base64'));
                            }
                            assets.push(item);
                            sendLog(`[다운로드 성공] ${item.localPath}`);
                        } catch (e) {
                            failedAssets.push({ url: item.url, error: e.message });
                            sendLog(`[다운로드 실패] ${item.url} - ${e.message}`, 'error');
                        }
                    }
                };
                await Promise.all(Array.from({ length: limit }).map(exec));
            }
            await processQueue(pageData.assetUrls, 5);
        }

        const manifest = { targetUrl: url, extractedAt: new Date().toISOString(), assets, failedAssets };
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(outDir, 'README.md'), `# Clone of ${domain}\n\nOpen \`index.html\` to view the cloned structure.`);

        sendLog('클론 프로젝트 조립 완료!');

        return { 
            success: true, 
            message: `[추출 완료] ${url} 구조 분석 및 클론 성공`, 
            data: { ...pageData, assets, failedAssets, clonePath: outDir }
        };
    } catch (error) {
        return { success: false, message: error.message };
    } finally {
        try {
            if (offscreenWindow && !offscreenWindow.isDestroyed()) {
                if (debuggerAttached && offscreenWindow.webContents.debugger.isAttached()) {
                    offscreenWindow.webContents.debugger.detach();
                }
                offscreenWindow.destroy();
            }
        } catch (e) {}
    }
});

ipcMain.handle('scaffold-backend', async (event, config) => {
    try {
        const outDir = config.outputDir;
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const pkgJson = {
            name: config.mallName.toLowerCase().replace(/\s+/g, '-'),
            version: "1.1.0",
            description: "GJC Reverse Engineered E-commerce Backend (Secure)",
            main: "server.js",
            scripts: { start: "node server.js" },
            dependencies: {
                "express": "^4.18.2",
                "better-sqlite3": "^12.11.1",
                "cors": "^2.8.5"
            }
        };
        fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

        const serverJs = `
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
// bcrypt, jsonwebtoken omitted here for clarity unless needed in future. They were mock elements.

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new Database('shop.db');

db.exec(\`
  CREATE TABLE IF NOT EXISTS Product (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    options JSON,
    stock INTEGER DEFAULT 0,
    images TEXT,
    category TEXT,
    status TEXT DEFAULT 'active'
  );
  
  CREATE TABLE IF NOT EXISTS Orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    total_amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS OrderItem (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    option_detail TEXT,
    quantity INTEGER,
    unit_price INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS Admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'admin'
  );

  CREATE TABLE IF NOT EXISTS PriceRule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    option_key TEXT,
    price INTEGER
  );

  CREATE TABLE IF NOT EXISTS TaxInvoice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    business_number TEXT,
    company_name TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'requested',
    issued_at DATETIME
  );
\`);

const count = db.prepare('SELECT COUNT(*) as count FROM Admin').get();
if (count.count === 0) {
    const adminId = '${config.adminId}';
    const adminPw = '${config.adminPw}'; // Plaintext for now as requested removal of module dependency
    db.prepare('INSERT INTO Admin (username, password_hash) VALUES (?, ?)').run(adminId, adminPw);
    
    db.prepare('INSERT INTO Product (name, description, price, category) VALUES (?, ?, ?, ?)').run('Test Product', 'High quality', 100, 'Print');
    db.prepare('INSERT INTO PriceRule (product_id, option_key, price) VALUES (?, ?, ?)').run(1, 'Color', 50);
}

app.get('/api/products', (req, res) => {
    const products = db.prepare('SELECT * FROM Product WHERE status="active"').all();
    res.json(products);
});

app.post('/api/orders', (req, res) => {
    const { name, phone, items } = req.body;
    let total = 0;
    if (items && items.length > 0) {
        items.forEach(item => {
            const rule = db.prepare('SELECT price FROM PriceRule WHERE product_id = ? AND option_key = ?').get(item.productId, item.option);
            const unitPrice = rule ? rule.price : 0;
            total += unitPrice * item.quantity;
        });
    } else {
        total = 1000;
    }
    const stmt = db.prepare('INSERT INTO Orders (customer_name, customer_phone, total_amount) VALUES (?, ?, ?)');
    const info = stmt.run(name, phone, total);
    res.json({ success: true, orderId: info.lastInsertRowid, totalAmount: total });
});

app.get('/api/orders/:id', (req, res) => {
    const order = db.prepare('SELECT * FROM Orders WHERE id = ?').get(req.params.id);
    res.json(order || {});
});

// Basic dummy auth middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized: No token provided' });
    next();
};

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const row = db.prepare('SELECT * FROM Admin WHERE username = ?').get(username);
    
    // Plain text compare since bcrypt was removed
    if (row && password === row.password_hash) {
        res.json({ success: true, token: 'dummy_token' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.use('/api/admin', authenticateToken);

app.get('/api/admin/orders', (req, res) => {
    const orders = db.prepare('SELECT * FROM Orders ORDER BY created_at DESC').all();
    res.json(orders);
});

app.patch('/api/admin/orders/:id/status', (req, res) => {
    const stmt = db.prepare('UPDATE Orders SET status = ? WHERE id = ?');
    stmt.run(req.body.status, req.params.id);
    res.json({ success: true, newStatus: req.body.status });
});

app.post('/api/admin/invoices', (req, res) => {
    const { orderId, companyName, businessNumber } = req.body;
    const order = db.prepare('SELECT total_amount FROM Orders WHERE id = ?').get(orderId);
    if(!order) return res.status(404).json({ error: 'Order not found' });
    const stmt = db.prepare('INSERT INTO TaxInvoice (order_id, business_number, company_name, amount, status, issued_at) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(orderId, businessNumber, companyName, order.total_amount, 'issued', new Date().toISOString());
    res.json({ success: true, invoiceId: info.lastInsertRowid, status: 'issued' });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(\`E-commerce Backend (Secure) running on http://localhost:\${PORT}\`);
});
`;
        fs.writeFileSync(path.join(outDir, 'server.js'), serverJs);

        const publicDir = path.join(outDir, 'public');
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
        
        const indexHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>${config.mallName}</title>
    <style>
        :root {
            --primary-color: ${config.tokens.primaryColor};
            --secondary-color: ${config.tokens.secondaryColor};
            --bg-color: ${config.tokens.backgroundColor};
            --text-color: ${config.tokens.textColor};
            --font-family: ${config.tokens.primaryFont}, sans-serif;
        }
        body { font-family: var(--font-family); background-color: var(--bg-color); color: var(--text-color); margin: 0; }
        header { background-color: var(--primary-color); color: white; padding: 20px; text-align: center; }
        .container { max-width: 1000px; margin: 20px auto; padding: 20px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <header><h1>${config.mallName}</h1></header>
    <div class="container"><h2>환영합니다</h2></div>
</body>
</html>
`;
        fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml);

        return { success: true, message: `[생성 완료] ${config.mallName} 백엔드 스캐폴딩 성공 (경로: ${outDir})` };
    } catch (error) {
        return { success: false, message: error.message };
    }
});
// v3.3: Multi-page Support (Crawl Links)
ipcMain.handle('crawl-links', async (event, config) => {
    const { url, maxDepth, maxPages, excludePatterns, paramBlacklist, discoveryScope } = config;
    let offscreenWindow = null;
    const sendLog = (msg, type='info') => event.sender.send('log', msg, type);

    try {
        sendLog('링크 수집용 브라우저 시작...');
        offscreenWindow = new BrowserWindow({
            show: false,
            webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
        });

        const normalizeUrl = (href, base) => {
            try {
                const u = new URL(href, base);
                u.hash = '';
                paramBlacklist.forEach(p => u.searchParams.delete(p.trim()));
                
                const keys = Array.from(u.searchParams.keys());
                keys.forEach(k => {
                    if (u.searchParams.get(k) === '') u.searchParams.delete(k);
                });
                u.searchParams.sort();
                
                let s = u.toString();
                if (s.endsWith('/') && s.length > u.origin.length + 1) s = s.slice(0, -1);
                return s;
            } catch(e) { return null; }
        };

        const isExcluded = (u) => {
            const s = u.toLowerCase();
            const extMatch = s.match(/\.([a-z0-9]+)(?:[\?#]|$)/);
            if (extMatch) {
                const ext = extMatch[1];
                if (['pdf', 'zip', 'rar', 'exe', 'png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) return true;
            }
            return excludePatterns.some(p => p.trim() && s.includes(p.trim().toLowerCase()));
        };

        const startNormalized = normalizeUrl(url, url);
        if(!startNormalized) throw new Error("유효하지 않은 시작 URL입니다.");
        
        const queue = [{ url: startNormalized, depth: 0 }];
        const visited = new Set([startNormalized]);
        const results = [{ url: startNormalized, depth: 0 }];
        
        const fanOutMap = new Map();
        const excludedStats = [];
        const recordExcluded = (reason, pattern) => {
            const stat = excludedStats.find(s => s.pattern === pattern);
            if (stat) stat.count++;
            else excludedStats.push({ reason, pattern, count: 1 });
        };

        while (queue.length > 0 && visited.size < maxPages) {
            const current = queue.shift();
            sendLog(`[링크 수집 중] (${visited.size}개 확인됨) 깊이:${current.depth} - ${current.url}`);
            
            try {
                await offscreenWindow.loadURL(current.url, { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                sendLog(`로딩 실패 (무시됨): ${current.url}`, 'error');
                continue;
            }
            
            if (current.depth >= maxDepth) continue;

            const selector = discoveryScope === 'nav' ? 'nav a, header a, footer a' : 'a';
            const hrefs = await offscreenWindow.webContents.executeJavaScript(`
                Array.from(document.querySelectorAll('${selector}')).map(a => a.href).filter(h => h && !h.startsWith('javascript:'))
            `);

            for (const href of hrefs) {
                const norm = normalizeUrl(href, current.url);
                if (!norm) continue;
                
                let parsed;
                try {
                    parsed = new URL(norm);
                    const baseParsed = new URL(url);
                    if (parsed.origin !== baseParsed.origin) continue; // sameOriginOnly
                } catch(e) { continue; }

                if (isExcluded(norm)) {
                    const extMatch = norm.match(/\.([a-z0-9]+)(?:[\?#]|$)/);
                    if (extMatch && ['pdf', 'zip', 'rar', 'exe', 'png', 'jpg', 'jpeg', 'gif', 'svg'].includes(extMatch[1])) {
                        recordExcluded('확장자 제외', extMatch[1]);
                    } else {
                        recordExcluded('제외 패턴 매칭', norm.split('?')[0]);
                    }
                    continue;
                }

                // Fan-out detection
                const paramKeys = Array.from(parsed.searchParams.keys()).sort().join(',');
                const pathKey = parsed.pathname + (paramKeys ? '?' + paramKeys : '');
                
                if (!fanOutMap.has(pathKey)) fanOutMap.set(pathKey, new Set());
                const pathSet = fanOutMap.get(pathKey);
                pathSet.add(norm);
                
                if (pathSet.size > 100) {
                    recordExcluded('Fan-out 자동 차단 (게시판/상품 무한증식 방지)', pathKey);
                    continue;
                }

                if (!visited.has(norm)) {
                    visited.add(norm);
                    results.push({ url: norm, depth: current.depth + 1 });
                    queue.push({ url: norm, depth: current.depth + 1 });
                    if (visited.size >= maxPages) {
                        sendLog(`⚠️ 최대 페이지 상한(${maxPages}개) 도달 — 전체 수집이 아닐 수 있음`, 'warn');
                        break;
                    }
                }
            }
        }

        if (visited.size < maxPages) {
            sendLog(`전체 ${results.length}개 고유 URL 수집 완료.`);
        }
        
        excludedStats.forEach(s => {
            sendLog(`[제외] ${s.reason}: ${s.pattern} (${s.count}건)`);
        });

        return { success: true, data: results, excludedStats };
    } catch (e) {
        return { success: false, message: e.message };
    } finally {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) offscreenWindow.destroy();
    }
});
// v3.4: Analyze Site (Analyze-First Loop)
ipcMain.handle('analyze-site', async (event, config) => {
    const { url, outDirBase } = config;
    let offscreenWindow = null;
    let debuggerAttached = false;
    const sendLog = (msg, type='info') => event.sender.send('log', msg, type);

    try {
        const domain = new URL(url).hostname;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outDir = path.join(outDirBase, `analyze_${domain}_${timestamp}`);
        fs.mkdirSync(outDir, { recursive: true });

        offscreenWindow = new BrowserWindow({
            show: false,
            webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
        });

        const apiTraffic = [];
        const reqMap = new Map();

        let debuggerSetupPromise = null;

        offscreenWindow.webContents.once('did-start-loading', () => {
            debuggerSetupPromise = (async () => {
                try {
                    if (offscreenWindow.webContents.debugger.isAttached()) {
                        offscreenWindow.webContents.debugger.detach();
                    }
                    offscreenWindow.webContents.debugger.attach('1.3');
                    
                    const enableCmd = offscreenWindow.webContents.debugger.sendCommand('Network.enable');
                    const cacheCmd = offscreenWindow.webContents.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true });
                    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('CDP Network.enable 타임아웃 (10초)')), 10000));
                    
                    await Promise.race([Promise.all([enableCmd, cacheCmd]), timeout]);
                    
                    debuggerAttached = true;
                    sendLog('디버거 부착 완료 (API 트래픽 캡처 모드)');
                    
                    offscreenWindow.webContents.debugger.on('message', async (e, method, params) => {
                        try {
                            if (method === 'Network.requestWillBeSent') {
                                reqMap.set(params.requestId, {
                                    url: params.request.url,
                                    method: params.request.method,
                                    postData: params.request.postData,
                                    headers: params.request.headers
                                });
                            } else if (method === 'Network.responseReceived') {
                                const req = reqMap.get(params.requestId);
                                if (req && (params.type === 'XHR' || params.type === 'Fetch')) {
                                    req.status = params.response.status;
                                    req.mimeType = params.response.mimeType;
                                }
                            } else if (method === 'Network.loadingFinished') {
                                const req = reqMap.get(params.requestId);
                                if (req && req.status) {
                                    try {
                                        const { body, base64Encoded } = await offscreenWindow.webContents.debugger.sendCommand(
                                            'Network.getResponseBody', { requestId: params.requestId }
                                        );
                                        req.responseBody = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
                                        apiTraffic.push(req);
                                    } catch (err) {}
                                }
                                reqMap.delete(params.requestId);
                            }
                        } catch (err) {}
                    });
                } catch (e) {
                    sendLog('디버거 부착 실패 (API 캡처 불가): ' + e.message, 'error');
                    try {
                        if (offscreenWindow.webContents.debugger.isAttached()) offscreenWindow.webContents.debugger.detach();
                    } catch(err) {}
                }
            })();
        });

        sendLog(`분석용 URL 로딩 시작: ${url}`);
        const loadPromise = offscreenWindow.loadURL(url, { waitUntil: 'domcontentloaded' });
        
        await loadPromise;
        
        if (debuggerSetupPromise) {
            await debuggerSetupPromise;
        }
        await new Promise(r => setTimeout(r, 4000)); // Wait for initial API calls

        // 1. Generate OpenAPI spec from traffic
        const openApiSpec = {
            openapi: "3.0.0",
            info: { title: `Inferred API for ${domain}`, version: "1.0.0" },
            paths: {}
        };

        apiTraffic.forEach(req => {
            try {
                const u = new URL(req.url);
                if (u.hostname !== domain && !u.hostname.includes('api')) return; // Filter external analytics
                
                const pathSegments = u.pathname.split('/').map(seg => /^\d+$/.test(seg) ? '{id}' : seg);
                const pathStr = pathSegments.join('/') || '/';
                const method = req.method.toLowerCase();

                if (!openApiSpec.paths[pathStr]) openApiSpec.paths[pathStr] = {};
                
                if (!openApiSpec.paths[pathStr][method]) {
                    const op = {
                        summary: `Inferred ${req.method} ${pathStr}`,
                        responses: {
                            "200": { description: "Successful response" }
                        }
                    };

                    if (u.searchParams.toString()) {
                        op.parameters = Array.from(u.searchParams.keys()).map(k => ({
                            name: k,
                            in: "query",
                            schema: { type: "string" }
                        }));
                    }

                    if (req.responseBody && req.mimeType && req.mimeType.includes('json')) {
                        try {
                            const parsed = JSON.parse(req.responseBody);
                            op.responses["200"].content = {
                                "application/json": {
                                    example: Array.isArray(parsed) ? parsed.slice(0,2) : parsed
                                }
                            };
                        } catch(e) {}
                    }
                    openApiSpec.paths[pathStr][method] = op;
                }
            } catch(e) {}
        });

        const apiSpecPath = path.join(outDir, 'api-spec.json');
        fs.writeFileSync(apiSpecPath, JSON.stringify(openApiSpec, null, 2));

        // 2. Sitemap Fetching
        const sitemapUrls = [];
        try {
            const sitemapRes = await fetch(`${url}/sitemap.xml`, { signal: AbortSignal.timeout(10000) });
            if (sitemapRes.ok) {
                const xmlText = await sitemapRes.text();
                const matches = xmlText.match(/<loc>(.*?)<\/?loc>/g);
                if (matches) {
                    matches.forEach(m => sitemapUrls.push(m.replace(/<\/?loc>/g, '').trim()));
                }
            }
        } catch(e) {}

        // 3. Extract heuristic profile
        const profile = await offscreenWindow.webContents.executeJavaScript(`
            (() => {
                const p = {
                    siteType: 'server-rendered',
                    techStack: [],
                    menuTree: {},
                    urlPatterns: [],
                    pageEstimate: 0,
                    apiCount: ${apiTraffic.length},
                    crawlConfig: {
                        maxDepth: 2,
                        maxPages: 500,
                        excludePatterns: ['login', 'cart', 'member', 'mymenu', 'my_group', 'mypage', 'auth', 'board_style=view', 'write'],
                        paramBlacklist: [],
                        sitemapUrls: ${JSON.stringify(sitemapUrls)}
                    }
                };

                if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')) p.techStack.push('React');
                if (window.__VUE__ || document.querySelector('[data-v-app]')) p.techStack.push('Vue');
                if (window.__NUXT__) { p.techStack.push('Nuxt.js'); p.siteType = 'spa'; }
                if (window.__NEXT_DATA__) { p.techStack.push('Next.js'); p.siteType = 'spa'; }
                if (window.angular || document.querySelector('[ng-app]')) p.techStack.push('Angular');
                if (window.jQuery) p.techStack.push('jQuery');

                const navLinks = Array.from(document.querySelectorAll('nav a, header a, .menu a, .gnb a'));
                navLinks.forEach(a => {
                    if (a.href && a.innerText.trim()) {
                        const text = a.innerText.trim().replace(/\\n/g, ' ');
                        if (text.length < 20) p.menuTree[text] = a.href;
                    }
                });

                const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h && h.startsWith('http'));
                const uniqueLinks = [...new Set(allLinks)];
                p.pageEstimate = Math.max(10, uniqueLinks.length * 3);

                const trackParams = ['utm_source', 'utm_medium', 'utm_campaign', 'timeKey', 'sessionid', 'PHPSESSID', 'fbclid', 'gclid'];
                const detectedParams = new Set();
                uniqueLinks.forEach(l => {
                    try {
                        const u = new URL(l);
                        for (const key of u.searchParams.keys()) {
                            if (trackParams.includes(key) || key.startsWith('utm_')) {
                                detectedParams.add(key);
                            }
                        }
                    } catch(e){}
                });
                p.crawlConfig.paramBlacklist = Array.from(detectedParams);

                const patterns = {};
                uniqueLinks.forEach(l => {
                    try {
                        const u = new URL(l);
                        if (u.origin === window.location.origin) {
                            const pt = u.pathname.split('/').slice(0, 2).join('/');
                            patterns[pt] = (patterns[pt] || 0) + 1;
                        }
                    } catch(e){}
                });
                
                const sortedPatterns = Object.entries(patterns).sort((a,b) => b[1] - a[1]);
                p.urlPatterns = sortedPatterns.slice(0, 10).map(x => x[0]).filter(Boolean);

                if (p.urlPatterns.some(pt => pt.includes('board') || pt.includes('bbs') || pt.includes('forum'))) {
                    p.siteType = 'board-heavy';
                    p.crawlConfig.maxDepth = 2;
                } else if (p.urlPatterns.some(pt => pt.includes('product') || pt.includes('goods') || pt.includes('item'))) {
                    p.siteType = 'catalog';
                    p.crawlConfig.maxDepth = 2;
                } else if (p.urlPatterns.some(pt => pt.includes('blog') || pt.includes('post') || pt.includes('article'))) {
                    p.siteType = 'blog';
                    p.crawlConfig.maxDepth = 1;
                } else if (uniqueLinks.length < 5) {
                    p.siteType = 'single-landing';
                    p.crawlConfig.maxDepth = 0;
                }

                sortedPatterns.forEach(([pt, count]) => {
                    if (count > uniqueLinks.length * 0.3) {
                        if (pt.includes('board') || pt.includes('view') || pt.includes('article')) {
                            if (!p.crawlConfig.excludePatterns.includes(pt)) {
                                p.crawlConfig.excludePatterns.push(pt);
                            }
                        }
                    }
                });

                return p;
            })();
        `);

        sendLog(`분석 완료 (API 엔드포인트 ${profile.apiCount}개 탐지)`);
        
        return { 
            success: true, 
            profile,
            apiSpecPath: outDir 
        };
    } catch (error) {
        return { success: false, message: error.message };
    } finally {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
            if (debuggerAttached) try { offscreenWindow.webContents.debugger.detach(); } catch(e){}
            offscreenWindow.destroy();
        }
    }
});

// v3.3: Multi-page Support (Sequential Extract)
ipcMain.handle('extract-multi', async (event, config) => {
    const { urls, outDirBase, paramBlacklist } = config; 
    let offscreenWindow = null;
    let debuggerAttached = false;
    const sendLog = (msg, type='info') => event.sender.send('log', msg, type);

    try {
        if (!urls || urls.length === 0) throw new Error("추출할 URL이 없습니다.");
        const domain = new URL(urls[0].url).hostname;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outDir = path.join(outDirBase, `clone_${domain}_multi_${timestamp}`);
        
        fs.mkdirSync(path.join(outDir, 'css'), { recursive: true });
        fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
        fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });

        const urlMap = {};
        urls.forEach((u, i) => {
            if (i === 0) urlMap[u.url] = 'index.html';
            else {
                const parsed = new URL(u.url);
                let name = parsed.pathname.split('/').filter(Boolean).pop() || 'page';
                parsed.searchParams.forEach((val) => { name += `_${val}`; });
                name = name.replace(/[^a-zA-Z0-9_-]/g, '_');
                urlMap[u.url] = `pages/${name}_${i}.html`;
            }
        });
        fs.writeFileSync(path.join(outDir, 'urlmap.json'), JSON.stringify(urlMap, null, 2));

        offscreenWindow = new BrowserWindow({
            show: false,
            webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
        });

        const capturedBodies = new Map();
        const reqOriginalUrl = new Map();
        const reqFinalUrl = new Map();

        let debuggerSetupPromise = null;

        offscreenWindow.webContents.once('did-start-loading', () => {
            debuggerSetupPromise = (async () => {
                try {
                    if (offscreenWindow.webContents.debugger.isAttached()) {
                        offscreenWindow.webContents.debugger.detach();
                    }
                    offscreenWindow.webContents.debugger.attach('1.3');
                    
                    const enableCmd = offscreenWindow.webContents.debugger.sendCommand('Network.enable');
                    const cacheCmd = offscreenWindow.webContents.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true });
                    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('CDP Network.enable 타임아웃 (10초)')), 10000));
                    
                    await Promise.race([Promise.all([enableCmd, cacheCmd]), timeout]);
                    
                    debuggerAttached = true;
                    sendLog('전역 디버거 부착 완료 (다중 페이지 자동 캡처 모드)');
                    
                    offscreenWindow.webContents.debugger.on('message', async (e, method, params) => {
                        try {
                            if (method === 'Network.requestWillBeSent') {
                                reqOriginalUrl.set(params.requestId, params.request.url);
                            } else if (method === 'Network.responseReceived') {
                                reqFinalUrl.set(params.requestId, { url: params.response.url, mimeType: params.response.mimeType });
                            } else if (method === 'Network.loadingFinished') {
                                const requestId = params.requestId;
                                const original = reqOriginalUrl.get(requestId);
                                const finalObj = reqFinalUrl.get(requestId);
                                const u_arr = [original, finalObj ? finalObj.url : null].filter(Boolean);
                                try {
                                    const { body, base64Encoded } = await offscreenWindow.webContents.debugger.sendCommand(
                                        'Network.getResponseBody', { requestId }
                                    );
                                    const buf = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
                                    const mimeType = finalObj ? finalObj.mimeType : '';
                                    for (const u of u_arr) capturedBodies.set(u, { buf, mimeType });
                                } catch (err) {}
                                reqOriginalUrl.delete(requestId);
                                reqFinalUrl.delete(requestId);
                            }
                        } catch (err) {}
                    });
                } catch (e) {
                    sendLog('디버거 부착 실패: ' + e.message, 'error');
                    try {
                        if (offscreenWindow.webContents.debugger.isAttached()) offscreenWindow.webContents.debugger.detach();
                    } catch(err) {}
                }
            })();
        });

        const globalCssMap = {};
        const globalImgMap = {};
        let nextCssId = 0;
        let nextImgId = 0;
        let nextInlineId = 0;

        const manifest = { targetUrl: urls[0].url, extractedAt: new Date().toISOString(), pages: [], failedPages: [], assets: [], duplicatePages: [] };
        const contentHashes = new Map();

        for (let i = 0; i < urls.length; i++) {
            const currentUrl = urls[i].url;
            const localPath = urlMap[currentUrl];
            sendLog(`[순차 추출] (${i+1}/${urls.length}) ${currentUrl}`);

            try {
                const loadPromise = offscreenWindow.loadURL(currentUrl, { waitUntil: 'domcontentloaded' });
                await loadPromise;
                
                if (i === 0 && debuggerSetupPromise) {
                    await debuggerSetupPromise;
                }

                await new Promise(r => setTimeout(r, 1500)); // delayMs

                if (i === 0) {
                    const image = await offscreenWindow.webContents.capturePage();
                    fs.writeFileSync(path.join(outDir, 'screenshot.png'), image.toPNG());
                }

                const pageData = await offscreenWindow.webContents.executeJavaScript(`
                    (() => {
                        const urlMap = ${JSON.stringify(urlMap)};
                        const paramBlacklist = ${JSON.stringify(paramBlacklist)};
                        const currentLocalPath = "${localPath}";
                        const prefix = currentLocalPath === 'index.html' ? './' : '../';
                        
                        function normalize(href) {
                            try {
                                const u = new URL(href, window.location.href);
                                u.hash = '';
                                paramBlacklist.forEach(p => u.searchParams.delete(p.trim()));
                                let s = u.toString();
                                if (s.endsWith('/') && s.length > u.origin.length + 1) s = s.slice(0, -1);
                                return s;
                            } catch(e) { return href; }
                        }

                        document.querySelectorAll('a').forEach(a => {
                            if (!a.href || a.href.startsWith('javascript:')) return;
                            const norm = normalize(a.href);
                            if (urlMap[norm]) {
                                const to = urlMap[norm];
                                if (currentLocalPath === 'index.html') a.href = './' + to;
                                else if (to === 'index.html') a.href = '../index.html';
                                else a.href = './' + to.replace('pages/', '');
                            } else {
                                a.target = "_blank";
                            }
                        });

                        const globalCssMap = ${JSON.stringify(globalCssMap)};
                        const globalImgMap = ${JSON.stringify(globalImgMap)};
                        let nextCssId = ${nextCssId};
                        let nextImgId = ${nextImgId};
                        let nextInlineId = ${nextInlineId};

                        const newAssets = [];
                        
                        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
                            if (el.href && !el.href.startsWith('data:')) {
                                let lp = globalCssMap[el.href];
                                if (!lp) {
                                    lp = 'css/style-' + (nextCssId++) + '.css';
                                    newAssets.push({ url: el.href, localPath: lp, type: 'css' });
                                }
                                el.href = prefix + lp;
                            }
                        });

                        document.querySelectorAll('img, source').forEach(el => {
                            const rawSrc = el.getAttribute('src');
                            if (!rawSrc || rawSrc.trim() === '') return;
                            if (el.src && !el.src.startsWith('data:')) {
                                let lp = globalImgMap[el.src];
                                if (!lp) {
                                    const ext = el.src.split('.').pop().split('?')[0] || 'png';
                                    const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                                    lp = 'assets/img-' + (nextImgId++) + '.' + safeExt;
                                    newAssets.push({ url: el.src, localPath: lp, type: 'asset' });
                                }
                                el.src = prefix + lp;
                            }
                            if (el.srcset) el.removeAttribute('srcset');
                        });

                        const parseCssUrls = (text, isInline) => {
                            const matches = text.match(/url\(['"]?(.*?)['"]?\)/g);
                            if (!matches) return text;
                            let newText = text;
                            matches.forEach(m => {
                                const inner = m.replace(/url\(['"]?/, '').replace(/['"]?\)/, '').trim();
                                if (!inner || inner.startsWith('data:')) return;
                                try {
                                    const u = new URL(inner, window.location.href).toString();
                                    let lp = globalImgMap[u];
                                    if (!lp) {
                                        const ext = u.split('.').pop().split('?')[0] || 'png';
                                        const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                                        lp = 'assets/img-' + (nextImgId++) + '.' + safeExt;
                                        newAssets.push({ url: u, localPath: lp, type: 'asset' });
                                    }
                                    const newUrl = prefix + lp;
                                    newText = newText.replace(m, 'url("' + newUrl + '")');
                                } catch(e){}
                            });
                            return newText;
                        };

                        document.querySelectorAll('*[style]').forEach(el => {
                            const newStyle = parseCssUrls(el.getAttribute('style'), true);
                            if (newStyle !== el.getAttribute('style')) el.setAttribute('style', newStyle);
                        });

                        document.querySelectorAll('style').forEach(el => {
                            const parsedCss = parseCssUrls(el.innerHTML, false);
                            const lp = 'css/inline-' + (nextInlineId++) + '.css';
                            newAssets.push({ text: parsedCss, localPath: lp, type: 'inline-css' });
                            const link = document.createElement('link');
                            link.rel = 'stylesheet';
                            link.href = prefix + lp;
                            el.replaceWith(link);
                        });

                        document.querySelectorAll('script, iframe, noscript').forEach(s => s.remove());
                        const iter = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT, null, false);
                        let node;
                        const comments = [];
                        while(node = iter.nextNode()) comments.push(node);
                        comments.forEach(c => c.remove());

                        let tokens = null, layout = null, components = null;
                        if (currentLocalPath === 'index.html') {
                            const colorMap = {};
                            const fonts = new Set();
                            document.querySelectorAll('*').forEach(el => {
                                const s = window.getComputedStyle(el);
                                const bg = s.backgroundColor;
                                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colorMap[bg] = (colorMap[bg] || 0) + 1;
                                const c = s.color;
                                if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colorMap[c] = (colorMap[c] || 0) + 1;
                                if (s.fontFamily) fonts.add(s.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
                            });
                            tokens = {
                                colors: Object.entries(colorMap).sort((a,b)=>b[1]-a[1]).map(e=>e[0]).slice(0,10),
                                fonts: Array.from(fonts)
                            };
                            layout = { sections: [] };
                            components = [];
                        }

                        return {
                            html: document.documentElement.outerHTML,
                            textContent: document.body ? document.body.innerText.replace(/\s+/g, ' ').toLowerCase() : '',
                            newAssets, tokens, layout, components,
                            nextCssId, nextImgId, nextInlineId
                        };
                    })();
                `);

                nextCssId = pageData.nextCssId;
                nextImgId = pageData.nextImgId;
                nextInlineId = pageData.nextInlineId;
                
                const crypto = require('crypto');
                const hash = crypto.createHash('sha256').update(pageData.textContent).digest('hex');
                if (contentHashes.has(hash)) {
                    sendLog(`[콘텐츠 중복 제외] ${currentUrl}`);
                    manifest.duplicatePages.push(currentUrl);
                    urlMap[currentUrl] = contentHashes.get(hash);
                    continue; 
                }
                contentHashes.set(hash, localPath);

                for (const item of pageData.newAssets) {
                    if (item.type === 'css') globalCssMap[item.url] = item.localPath;
                    if (item.type === 'asset') globalImgMap[item.url] = item.localPath;

                    try {
                        if (item.type === 'inline-css') {
                            fs.writeFileSync(path.join(outDir, item.localPath), item.text);
                        } else {
                            const decUrl = decodeURIComponent(item.url);
                            let bodyData = capturedBodies.get(item.url) || capturedBodies.get(decUrl);
                            if (bodyData) {
                                if (bodyData.mimeType && bodyData.mimeType.includes('text/html')) {
                                    sendLog(`[MIME 불일치] ${item.url} (text/html)`);
                                    continue;
                                }
                                if (item.type === 'css') {
                                    let cssText = bodyData.buf.toString('utf8');
                                    const matches = cssText.match(/url\(['"]?(.*?)['"]?\)/g);
                                    if (matches) {
                                        matches.forEach(m => {
                                            const inner = m.replace(/url\(['"]?/, '').replace(/['"]?\)/, '').trim();
                                            if (!inner || inner.startsWith('data:')) return;
                                            try {
                                                const u = new URL(inner, item.url).toString();
                                                let lp = globalImgMap[u];
                                                if (!lp) {
                                                    const ext = u.split('.').pop().split('?')[0] || 'png';
                                                    const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext : 'png';
                                                    lp = 'assets/img-' + (nextImgId++) + '.' + safeExt;
                                                    globalImgMap[u] = lp;
                                                    
                                                    const decU = decodeURIComponent(u);
                                                    const innerBody = capturedBodies.get(u) || capturedBodies.get(decU);
                                                    if (innerBody) {
                                                        fs.writeFileSync(path.join(outDir, lp), innerBody.buf);
                                                        capturedBodies.delete(u);
                                                        capturedBodies.delete(decU);
                                                        manifest.assets.push(lp);
                                                    }
                                                }
                                                const newRelativePath = '../' + lp;
                                                cssText = cssText.split(m).join(`url("${newRelativePath}")`);
                                            } catch(e){}
                                        });
                                    }
                                    fs.writeFileSync(path.join(outDir, item.localPath), cssText);
                                } else {
                                    fs.writeFileSync(path.join(outDir, item.localPath), bodyData.buf);
                                }
                                capturedBodies.delete(item.url); 
                                capturedBodies.delete(decUrl);
                            } else {
                                sendLog(`[에셋 바디 없음] ${item.url}`, 'error');
                            }
                        }
                        manifest.assets.push(item.localPath);
                    } catch (e) {
                        sendLog(`[에셋 실패] ${item.localPath} - ${e.message}`, 'error');
                    }
                }

                fs.writeFileSync(path.join(outDir, localPath), '<!DOCTYPE html>\n<html>\n' + pageData.html + '\n</html>');
                manifest.pages.push(currentUrl);
                
                if (i === 0) {
                    manifest.tokens = pageData.tokens;
                    manifest.layout = pageData.layout;
                    manifest.components = pageData.components;
                }
            } catch (e) {
                sendLog(`[페이지 실패] ${currentUrl} - ${e.message}`, 'error');
                manifest.failedPages.push({ url: currentUrl, error: e.message });
            }
        }
        fs.writeFileSync(path.join(outDir, 'urlmap.json'), JSON.stringify(urlMap, null, 2));
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(outDir, 'README.md'), `# Multi-page Clone of ${domain}\n\nOpen \`index.html\` to view the cloned structure.\n\nTotal pages: ${manifest.pages.length}`);

        sendLog('멀티페이지 클론 순차 추출 및 조립 완료!');

        return { 
            success: true, 
            message: `[완료] 총 ${manifest.pages.length}페이지 클론 성공`, 
            data: { clonePath: outDir, assets: manifest.assets, tokens: manifest.tokens, layout: manifest.layout, components: manifest.components } 
        };
    } catch (error) {
        return { success: false, message: error.message };
    } finally {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
            if (debuggerAttached) try { offscreenWindow.webContents.debugger.detach(); } catch(e){}
            offscreenWindow.destroy();
        }
    }
});