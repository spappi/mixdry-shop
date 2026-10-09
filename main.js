const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

ipcMain.handle('extract-frontend', async (event, url) => {
    let offscreenWindow = null;
    const sendLog = (msg) => event.sender.send('log', msg, 'info');
    
    try {
        sendLog('오프스크린 브라우저 초기화 중...');
        offscreenWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                offscreen: true,
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        sendLog(`타겟 URL 로딩 시작: ${url}`);
        await offscreenWindow.loadURL(url);
        
        sendLog('디자인 토큰(색상 빈도수, 폰트) 추출 중...');
        const tokens = await offscreenWindow.webContents.executeJavaScript(`
            (() => {
                const colorMap = {};
                const fonts = new Set();
                const sections = [];
                const components = [];
                const scripts = [];
                
                // 1. 색상 및 폰트 추출
                document.querySelectorAll('*').forEach(el => {
                    const s = window.getComputedStyle(el);
                    
                    const bg = s.backgroundColor;
                    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                        colorMap[bg] = (colorMap[bg] || 0) + 1;
                    }
                    
                    const c = s.color;
                    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
                        colorMap[c] = (colorMap[c] || 0) + 1;
                    }
                    
                    if (s.fontFamily) {
                        fonts.add(s.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
                    }
                });
                
                const sortedColors = Object.entries(colorMap)
                    .sort((a, b) => b[1] - a[1])
                    .map(e => e[0]);
                    
                // 2. 레이아웃 구조 추출
                document.querySelectorAll('header, nav, main, section, article, aside, footer').forEach(el => {
                    sections.push({
                        tag: el.tagName.toLowerCase(),
                        className: el.className,
                        id: el.id
                    });
                });
                
                // 3. 컴포넌트 인벤토리 추출
                document.querySelectorAll('button, input, textarea, select, table, form').forEach(el => {
                    components.push({
                        type: el.tagName.toLowerCase(),
                        inputType: el.type || null
                    });
                });
                
                // 4. 로직 요약 추출
                document.querySelectorAll('script').forEach(el => {
                    if(el.src) scripts.push(el.src);
                });
                
                return {
                    tokens: {
                        colors: sortedColors,
                        fonts: Array.from(fonts),
                        spacing: ['8px', '16px', '24px'] // 휴리스틱 더미
                    },
                    layout: { sections },
                    components,
                    scripts,
                    elementCount: document.querySelectorAll('*').length
                };
            })();
        `);

        sendLog('레이아웃 구조 및 컴포넌트 분석 완료...');
        
        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
            offscreenWindow.destroy();
        }

        return { 
            success: true, 
            message: `[추출 완료] ${url} 구조 분석 성공`, 
            data: tokens 
        };
    } catch (error) {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
            offscreenWindow.destroy();
        }
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
            scripts: {
                start: "node server.js"
            },
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

// verbose: console.log 제거 (보안 하드닝)
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

// 목업 데이터 및 Admin 계정 해싱 시드 삽입
const count = db.prepare('SELECT COUNT(*) as count FROM Admin').get();
if (count.count === 0) {
    const adminId = '${config.adminId}';
    const adminPw = '${config.adminPw}';
    // Admin 비밀번호 bcrypt 해싱 적용
    const hash = bcrypt.hashSync(adminPw, 10);
    db.prepare('INSERT INTO Admin (username, password_hash) VALUES (?, ?)').run(adminId, hash);
    
    db.prepare('INSERT INTO Product (name, description, price, category) VALUES (?, ?, ?, ?)').run('Test Product', 'High quality', 100, 'Print');
    db.prepare('INSERT INTO PriceRule (product_id, option_key, price) VALUES (?, ?, ?)').run(1, 'Color', 50);
}

// ==== Public API ====
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

// ==== Admin Security Middleware ====
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

// ==== Protected Admin API ====
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