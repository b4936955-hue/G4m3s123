const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('assets/index.html', 'utf8');
const start = html.indexOf('    function setFavicon(url) {');
const end = html.indexOf('    function updateCloakPreview', start);
let icons = [];
const document = {
  createElement: () => ({ remove() { icons = icons.filter(icon => icon !== this); } }),
  querySelectorAll: () => [...icons],
  head: { appendChild(icon) { icons.push(icon); } }
};
const context = vm.createContext({ document });
vm.runInContext(html.slice(start, end), context);
context.setFavicon('data:image/vnd.microsoft.icon;base64,AAAB');
assert.equal(icons.length, 1);
assert.equal(icons[0].type, 'image/vnd.microsoft.icon');
context.setFavicon('https://example.com/new.ico');
assert.equal(icons.length, 1);
assert.equal(icons[0].href, 'https://example.com/new.ico');
assert.equal(icons[0].type, 'image/x-icon');
context.setFavicon('data:image/png;base64,AAA');
assert.equal(icons[0].type, 'image/png');
console.log('PASS: favicon changes immediately, preserves image types, and removes previous icons.');
