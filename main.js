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
    try {
        offscreenWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                offscreen: true,
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        await offscreenWindow.loadURL(url);

        const tokens = await offscreenWindow.webContents.executeJavaScript(`
            (() => {
                const styles = window.getComputedStyle(document.body);
                const colors = new Set();
                const fonts = new Set();
                
                document.querySelectorAll('button, a, header, footer, .primary, .btn, h1, h2').forEach(el => {
                    const s = window.getComputedStyle(el);
                    if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
                        colors.add(s.backgroundColor);
                    }
                    if (s.color && s.color !== 'rgba(0, 0, 0, 0)' && s.color !== 'transparent') {
                        colors.add(s.color);
                    }
                    if (s.fontFamily) {
                        fonts.add(s.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
                    }
                });
                
                const colorArr = Array.from(colors);
                const fontArr = Array.from(fonts);
                
                return {
                    primaryColor: colorArr[0] || '#333333',
                    secondaryColor: colorArr[1] || '#007bff',
                    backgroundColor: styles.backgroundColor || '#ffffff',
                    textColor: styles.color || '#333333',
                    primaryFont: fontArr[0] || 'sans-serif',
                    secondaryFont: fontArr[1] || 'sans-serif',
                    elementCount: document.querySelectorAll('*').length
                };
            })();
        `);

        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
            offscreenWindow.destroy();
        }

        return { 
            success: true, 
            message: `[추출 완료] ${url} 디자인 토큰 및 구조 분석 성공`, 
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
            version: "1.0.0",
            description: "GJC Reverse Engineered E-commerce Backend",
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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new Database('shop.db', { verbose: console.log });

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

const count = db.prepare('SELECT COUNT(*) as count FROM Product').get();
if (count.count === 0) {
    db.prepare('INSERT INTO Product (name, description, price, category) VALUES (?, ?, ?, ?)').run('Test Print A4', 'High quality printing', 100, 'Print');
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

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin') {
        const token = require('jsonwebtoken').sign({ username, role: 'admin' }, SECRET);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

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
    console.log(\`E-commerce Backend running on http://localhost:\${PORT}\`);
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.mallName}</title>
    <style>
        :root {
            --primary-color: ${config.tokens.primaryColor};
            --secondary-color: ${config.tokens.secondaryColor};
            --bg-color: ${config.tokens.backgroundColor};
            --text-color: ${config.tokens.textColor};
            --font-family: ${config.tokens.primaryFont}, ${config.tokens.secondaryFont}, sans-serif;
        }
        body {
            font-family: var(--font-family);
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 0;
        }
        header {
            background-color: var(--primary-color);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .container {
            max-width: 1000px;
            margin: 20px auto;
            padding: 20px;
            background: white;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        button {
            background-color: var(--secondary-color);
            color: white;
            border: none;
            padding: 10px 20px;
            cursor: pointer;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <header>
        <h1>${config.mallName}</h1>
    </header>
    <div class="container">
        <h2>상품 목록</h2>
        <div id="product-list"></div>
        <hr>
        <button onclick="placeOrder()">임시 주문 생성</button>
    </div>
    <script>
        fetch('/api/products')
            .then(res => res.json())
            .then(data => {
                const list = document.getElementById('product-list');
                data.forEach(p => {
                    list.innerHTML += \`<p>\${p.name} - \${p.price}원</p>\`;
                });
            });

        function placeOrder() {
            fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '홍길동', phone: '010-1234-5678', items: [] })
            }).then(res => res.json()).then(data => alert('주문 생성 완료: ' + data.orderId));
        }
    </script>
</body>
</html>
`;
        fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml);

        const readmeMd = `
# ${config.mallName}

GJC 리버싱 워크벤치로 자동 생성된 풀스택 쇼핑몰 프로젝트입니다.

## 실행 방법

1. 의존성 설치:
   \`\`\`bash
   npm install
   \`\`\`

2. 서버 실행:
   \`\`\`bash
   npm start
   \`\`\`

3. 브라우저 접속:
   http://localhost:3000
`;
        fs.writeFileSync(path.join(outDir, 'README.md'), readmeMd);

        return { success: true, message: `[생성 완료] ${config.mallName} 백엔드 스캐폴딩 성공 (경로: ${outDir})` };
    } catch (error) {
        return { success: false, message: error.message };
    }
});
