const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');
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

ipcMain.handle('open-folder', async (event, folderPath) => {
    shell.showItemInFolder(folderPath);
});

ipcMain.handle('extract-frontend', async (event, config) => {
    const { url, outDirBase } = config;
    let offscreenWindow = null;
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

        sendLog(`타겟 URL 로딩 시작: ${url}`);
        await offscreenWindow.loadURL(url, { waitUntil: 'domcontentloaded' });
        
        sendLog('추가 리소스 로딩 대기 중 (3초)...');
        await new Promise(r => setTimeout(r, 3000));
        
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
        
        if (offscreenWindow && !offscreenWindow.isDestroyed()) offscreenWindow.destroy();

        fs.writeFileSync(path.join(outDir, 'index.html'), '<!DOCTYPE html>\n<html>\n' + pageData.html + '\n</html>');
        
        sendLog(`총 ${pageData.assetUrls.length}개 에셋/CSS 다운로드 시작... (동시성 5 제한)`);

        const failedAssets = [];
        const assets = [];

        async function processQueue(items, limit) {
            let i = 0;
            const exec = async () => {
                while (i < items.length) {
                    const item = items[i++];
                    try {
                        if (item.type === 'inline-css') {
                            fs.writeFileSync(path.join(outDir, item.localPath), item.text);
                        } else {
                            const res = await fetch(item.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                            if (!res.ok) throw new Error(res.statusText);
                            const buffer = Buffer.from(await res.arrayBuffer());
                            fs.writeFileSync(path.join(outDir, item.localPath), buffer);
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

        const manifest = { targetUrl: url, extractedAt: new Date().toISOString(), assets, failedAssets };
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(outDir, 'README.md'), `# Clone of ${domain}\n\nOpen \`index.html\` to view the cloned structure.`);

        sendLog('클론 프로젝트 조립 완료!');

        return { 
            success: true, 
            message: `[추출 완료] ${url} 구조 분석 및 클론 성공`, 
            data: { ...pageData.tokens, assets, failedAssets, clonePath: outDir }
        };
    } catch (error) {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) offscreenWindow.destroy();
        return { success: false, message: error.message };
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
                "better-sqlite3": "^9.4.3",
                "cors": "^2.8.5",
                "bcrypt": "^5.1.1",
                "jsonwebtoken": "^9.0.2"
            }
        };
        fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

        const serverJs = `
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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
    const adminPw = '${config.adminPw}';
    const hash = bcrypt.hashSync(adminPw, 10);
    db.prepare('INSERT INTO Admin (username, password_hash) VALUES (?, ?)').run(adminId, hash);
    
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

const SECRET = 'super_secret_jwt_key';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });
    
    jwt.verify(token, SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden: Invalid token' });
        req.user = user;
        next();
    });
};

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const row = db.prepare('SELECT * FROM Admin WHERE username = ?').get(username);
    
    if (row && bcrypt.compareSync(password, row.password_hash)) {
        const token = jwt.sign({ username: row.username, role: row.role }, SECRET, { expiresIn: '1h' });
        res.json({ success: true, token });
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