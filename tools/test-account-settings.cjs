const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('assets/index.html', 'utf8');
const bootstrap = html.slice(html.indexOf('  <!-- Account-scoped'), html.indexOf('  <!-- Performance Mode')).match(/<script>([\s\S]*?)<\/script>/)[1];
const auth = fs.readFileSync('assets/community/auth-gate.js', 'utf8');
const core = auth.slice(0, auth.indexOf('  function clearActiveSettings()')) + '\nwindow.restore = restoreAccountSettings; }());';
class Storage {
  constructor() { this.values = new Map(); }
  getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
  key(i) { return [...this.values.keys()][i] || null; }
}
const localStorage = new Storage();
const listeners = {};
const document = { addEventListener(type, handler) { listeners[type] = handler; } };
const context = vm.createContext({ Storage, localStorage, sessionStorage: new Storage(), document, window: {}, setTimeout: () => 0, clearTimeout() {}, console });
localStorage.setItem('uzLoginEmail', 'alice');
vm.runInContext(bootstrap, context);
vm.runInContext(core, context);
context.window.__uzSettingsReady = true;
localStorage.setItem('accentColorV2', '#00ff9d');
localStorage.setItem('bgMode', 'topography');
localStorage.setItem('sidebarPosition', 'left');
context.window.restore('alice');
assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
assert.equal(localStorage.getItem('bgMode'), 'topography');
assert.equal(localStorage.getItem('sidebarPosition'), 'left');
localStorage.setItem('uzLoginEmail', 'bob');
context.window.restore('bob', { accentColorV2: '#0678d2', bgMode: 'waves' });
assert.equal(localStorage.getItem('accentColorV2'), '#0678d2');
assert.equal(localStorage.getItem('sidebarPosition'), null);
localStorage.setItem('uzLoginEmail', 'alice');
context.window.restore('alice');
assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
assert.equal(localStorage.getItem('bgMode'), 'topography');
assert.equal(localStorage.getItem('sidebarPosition'), 'left');
localStorage.setItem('uzacct:alice:activeCursor', 'custom.png');
context.window.restore('alice');
assert.equal(localStorage.getItem('activeCursor'), 'custom.png');
assert.equal(localStorage.getItem('uzacct:settings:alice:activeCursor'), 'custom.png');
listeners.click({ type: 'click', target: { closest: () => ({ getAttribute: () => "setAccent('#00ff9d')" }) } });
listeners.change({ type: 'change', target: { closest: () => ({ id: 'bg-select', value: 'topography' }) } });
context.window.restore('alice', { accentColorV2: '#ff6600', bgMode: 'starfield' });
assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
assert.equal(localStorage.getItem('bgMode'), 'topography');
context.window.UZImportAccountSettings({ 'uzacct:other:accentColorV2': '#7b2cbf', 'uzacct:settings:other:bgMode': 'waves', sidebarPosition: 'right', uzLoginEmail: 'other' });
context.window.restore('alice', { accentColorV2: '#ff6600', bgMode: 'starfield' });
assert.equal(localStorage.getItem('accentColorV2'), '#7b2cbf');
assert.equal(localStorage.getItem('bgMode'), 'waves');
assert.equal(localStorage.getItem('sidebarPosition'), 'right');
assert.equal(localStorage.getItem('uzLoginEmail'), 'alice');
assert.equal(context.window.UZExportAccountSettings().accentColorV2, '#7b2cbf');
let rendered = 0;
context.window.rehydrateSettings = () => { rendered++; };
context.window.UZImportAccountSettings({ accentColorV2: '#00ff9d', bgMode: 'topography', 'uzacct:settings:other:accentColorV2': '#ff6600', 'uzacct:other:bgMode': 'starfield' });
assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
assert.equal(localStorage.getItem('bgMode'), 'topography');
assert.equal(rendered, 1);
context.window.UZImportAccountSettings({ 'uzacct:billy41:accentColorV2': '#00ff9d', 'uzacct:billy41:bgMode': 'topography', 'uzacct:settings:billy41:accentColorV2': '#ff6600', 'uzacct:settings:billy41:bgMode': 'starfield', 'uzacct:alice:accentColorV2': '#ff6600' }, 'billy41');
assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
assert.equal(localStorage.getItem('bgMode'), 'topography');
assert.equal(localStorage.getItem('uzLoginEmail'), 'alice');
if (process.argv[2]) {
  const backup = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  context.window.UZImportAccountSettings(backup.settings, 'billy41');
  assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
  assert.equal(localStorage.getItem('bgMode'), 'topography');
  context.window.restore('alice', { accentColorV2: '#ff6600', bgMode: 'starfield' });
  assert.equal(localStorage.getItem('accentColorV2'), '#00ff9d');
  assert.equal(localStorage.getItem('bgMode'), 'topography');
}
console.log('PASS: imported settings persist, legacy keys normalize, and accounts remain isolated.');
