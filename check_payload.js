const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

const regex = /offscreenWindow\.webContents\.executeJavaScript\(\`([\s\S]*?)\`\)/g;
let match;
let count = 0;
while ((match = regex.exec(content)) !== null) {
    count++;
    let payload = match[1];
    
    // For `const currentLocalPath = "${localPath}";`, this will turn into `const currentLocalPath = "dummy";`
    payload = payload.replace(/"\$\{.*?\}"/g, '"dummy"');
    // For other `${var}`, replace with `{}`
    payload = payload.replace(/\$\{.*?\}/g, '{}');
    
    fs.writeFileSync(`payload_${count}.js`, payload);
}
