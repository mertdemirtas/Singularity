'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const assert = require('node:assert/strict'), { spawn, spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '../..');
const artifacts = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'singularity-native-check') : os.tmpdir();
fs.mkdirSync(artifacts, { recursive: true });
const directory = fs.mkdtempSync(path.join(artifacts, 'singularity-extension-removal-'));
const config = path.join(directory, 'config'), project = path.join(directory, 'project');
fs.mkdirSync(config); fs.mkdirSync(project);
fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'git.autofetch': false, 'telemetry.telemetryLevel': 'off' }));
fs.writeFileSync(path.join(config, 'recentworkspace.json'), JSON.stringify({ recentRoots: [pathToFileURL(project).href] }));
const fixtures = ['settings', 'sidebar'].map(name => {
  const id = 'remove-' + name, location = path.join(config, 'deployedPlugins', `singularity.${id}@0.0.1`, 'extension');
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(location, '../extension.vsixmanifest'), '<PackageManifest/>');
  fs.writeFileSync(path.join(location, 'package.json'), JSON.stringify({
    name: id, publisher: 'singularity', displayName: 'Remove ' + name, version: '0.0.1', engines: { vscode: '^1.85.0' },
    main: 'extension.cjs', activationEvents: ['*'], contributes: {
      viewsContainers: { activitybar: [{ id, title: 'Remove ' + name, icon: 'icon.svg' }] },
      views: { [id]: [{ id: id + '.tree', name: 'Fixture' }] },
      ...(name === 'settings' ? { configuration: { title: 'Fixture', properties: { 'removeFixture.enabled': { type: 'boolean', default: true, description: 'Example setting' } } } } : {})
    }
  }));
  fs.writeFileSync(path.join(location, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M4 4h16v16H4z" fill="gray"/></svg>');
  fs.writeFileSync(path.join(location, 'extension.cjs'), `exports.activate=()=>require('vscode').window.registerTreeDataProvider('${id}.tree',{getChildren:()=>[],getTreeItem:x=>x});`);
  return { id: 'singularity.' + id, view: 'workbench.view.extension.' + id, location };
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, browser, page;
const log = fs.createWriteStream(path.join(directory, 'desktop.log'));
async function until(check, label, timeout = 15000) { const end = Date.now() + timeout; while (!await check()) { if (Date.now() > end) throw Error('Timed out: ' + label); await pause(100); } }
async function launch() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const flags = ['--user-data-dir=' + path.join(directory, 'profile'), '--remote-debugging-port=' + port, '--disable-gpu'];
  if (process.platform === 'linux') flags.push('--ozone-platform=x11');
  child = spawn(process.execPath, ['scripts/launch-desktop.cjs', ...flags], { cwd: root, env: { ...process.env, THEIA_CONFIG_DIR: config, HOME: directory, USERPROFILE: directory }, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  await until(async () => { try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port, defaultViewport: null, protocolTimeout: 30000 }); return true; } catch { return false; } }, 'launch', 60000);
  page = await (await browser.waitForTarget(target => target.type() === 'page')).page();
  page.on('pageerror', error => log.write('PAGEERROR ' + error.stack + '\n'));
  await page.waitForSelector('body.plain-session-ready #plain-header', { timeout: 60000 });
}
async function menu(view) {
  await page.waitForSelector(`[data-sidebar-item="${view}"] button`, { visible: true });
  await page.click(`[data-sidebar-item="${view}"] button`, { button: 'right' });
  await page.waitForSelector('#plain-extension-view-context:not([hidden])');
}
async function action(label) {
  assert(await page.evaluate(label => {
    const button = [...document.querySelectorAll('#plain-extension-view-context button')].find(node => node.textContent === label);
    if (!button) return false; button.click(); return true;
  }, label), 'Menu contains ' + label);
}
async function close() {
  await page.evaluate(() => plainEditorDesktop.requestClose()); await until(() => child.exitCode !== null, 'normal close');
  await browser.disconnect(); child.stdout.destroy(); child.stderr.destroy();
}
(async () => {
  await launch();
  await menu(fixtures[0].view); await action('Extension settings…');
  await page.waitForSelector('#plain-extension-settings[open] [data-extension-action="remove"]');
  assert(await page.$('#plain-extension-settings [data-setting-key="removeFixture.enabled"]'), 'Extension preferences remain available');
  // A built-in extension must never offer removal in its settings dialog.
  assert(await page.evaluate(async () => {
    const values = [...theia.container._bindingDictionary._map.values()].flat().map(binding => binding.cache);
    window.removalCatalog = values.find(value => Object.keys(value || {}).includes('canRemoveView') && Array.isArray(value.popular));
    const builtin = removalCatalog.model.getExtension('vscode.python');
    if (!builtin?.builtin) return false;
    removalCatalog.openSettings(builtin);
    return !document.querySelector('#plain-extension-settings [data-extension-action="remove"]');
  }), 'Built-in settings do not offer removal');
  await page.click('#plain-extension-settings [aria-label="Close extension settings"]');
  await menu(fixtures[0].view); await action('Extension settings…');
  await page.waitForSelector('#plain-extension-settings[open] [data-extension-action="remove"]');
  await page.screenshot({ path: path.join(directory, 'settings.png') });
  await page.click('#plain-extension-settings [data-extension-action="remove"]');
  await page.waitForFunction(() => !document.querySelector('#plain-extension-settings').open);
  await until(() => !fs.existsSync(fixtures[0].location), 'settings removal deletes the installed extension');
  assert(fs.existsSync(fixtures[1].location), 'Removing one extension preserves others');
  await menu(fixtures[0].view);
  assert(!await page.$('#plain-extension-view-context .plain-extension-remove'), 'Already removed extension cannot be removed twice');
  await page.keyboard.press('Escape');
  await menu(fixtures[1].view);
  await action('Remove Extension');
  await until(() => !fs.existsSync(fixtures[1].location), 'sidebar removal deletes the installed extension');
  await page.waitForFunction(() => document.body.innerText.includes('Reload the window to finish.'));
  await close(); await launch();
  assert(!await page.$(`[data-sidebar-item="${fixtures[0].view}"]`), 'Settings-removed extension is absent after restart');
  assert(!await page.$(`[data-sidebar-item="${fixtures[1].view}"]`), 'Sidebar-removed extension is absent after restart');
  await close();
  console.log('PASS: remove from settings and sidebar, built-in protection, other extensions preserved, reload message, removal persists after restart');
})().catch(async error => {
  console.error(error.stack); process.exitCode = 1;
  if (page) { console.error(await page.evaluate(() => document.body.innerText).catch(() => 'closed')); await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); }
}).finally(async () => {
  await browser?.disconnect(); if (child?.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
  child?.stdout.destroy(); child?.stderr.destroy(); log.end(); console.log('Diagnostics:', directory);
});
