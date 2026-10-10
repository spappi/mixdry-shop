const cssText = 'background-image: url("assets/img-1.png");';

// What happens if the code literally has \\ in main.js?
// The source code currently has:
const scriptString = `
    const matches1 = cssText.match(/url\\(['"]?(.*?)['"]?\\)/g);
    const matches2 = cssText.match(/url\(['"]?(.*?)['"]?\)/g);
`;

console.log("String sent to browser:");
console.log(scriptString);

// Let's evaluate it
eval(scriptString);
console.log("matches1 (with \\\\):", matches1);
console.log("matches2 (with \\):", matches2);
