const cssText = 'background-image: url("assets/img-1.png");';

// Normal JS regex (1 backslash)
const matches1 = cssText.match(/url\(['"]?(.*?)['"]?\)/g);
console.log("matches1:", matches1);

// Normal JS regex (2 backslashes)
const matches2 = cssText.match(/url\\(['"]?(.*?)['"]?\\)/g);
console.log("matches2:", matches2);
