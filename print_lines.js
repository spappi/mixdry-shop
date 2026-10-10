const fs = require('fs');
const lines = fs.readFileSync('main.js', 'utf8').split('\n');
console.log("Line 1256: " + lines[1255]);
console.log("Line 1260: " + lines[1259]);
