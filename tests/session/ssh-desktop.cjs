'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const assert = require('node:assert/strict'), { spawn, spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer'), { fixture } = require('../backend/ssh-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const artifacts = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'singularity-native-check') : os.tmpdir();
fs.mkdirSync(artifacts, { recursive: true });
const directory = fs.mkdtempSync(path.join(artifacts, 'singularity-ssh-desktop-'));
const config = path.join(directory, 'config'), local = path.join(directory, 'local'); fs.mkdirSync(config); fs.mkdirSync(local);
fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'files.autoSave': 'off', 'git.autofetch': false, 'telemetry.telemetryLevel': 'off', ...(process.env.SSH_TEST_SHELL ? { 'terminal.integrated.shell.osx': process.env.SSH_TEST_SHELL } : {}) }));
fs.writeFileSync(path.join(config, 'recentworkspace.json'), JSON.stringify({ recentRoots: [pathToFileURL(local).href] }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let device, child, browser, page;
const log = fs.createWriteStream(path.join(directory, 'desktop.log'));
async function until(check, label, timeout = 15000) { const end = Date.now() + timeout; while (!await check()) { if (Date.now() > end) throw Error('Timed out: ' + label); await pause(100); } }
async function launch() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const flags = ['--user-data-dir=' + path.join(directory, 'profile'), '--remote-debugging-port=' + port, '--disable-gpu'];
  if (process.platform === 'linux') flags.push('--ozone-platform=x11');
  child = spawn(process.execPath, ['scripts/launch-desktop.cjs', ...flags], { cwd: root, env: { ...process.env, THEIA_CONFIG_DIR: config, HOME: directory, USERPROFILE: directory, SSH_AUTH_SOCK: '' }, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  await until(async () => { try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port, defaultViewport: null, protocolTimeout: 30000 }); return true; } catch { return false; } }, 'launch', 60000);
  page = await (await browser.waitForTarget(target => target.type() === 'page')).page();
  page.on('pageerror', error => log.write('PAGEERROR ' + error.stack + '\n'));
  await page.waitForSelector('body.plain-session-ready #plain-header', { timeout: 60000 });
  await page.evaluate(() => {
    const values = [...theia.container._bindingDictionary._map.values()].flat().map(binding => binding.cache);
    window.sshTestShell = values.find(value => Object.keys(value || {}).includes('mainPanel'));
    window.sshTestCommands = values.find(value => Object.keys(value || {}).includes('_commands'));
    window.sshTestConnection = values.find(value => Object.keys(value || {}).includes('_socket') && Object.keys(value || {}).includes('currentChannel'));
  });
}
async function terminal() {
  await page.evaluate(async () => {
    const existing = [...sshTestShell.bottomPanel.widgets()].find(widget => widget.kind === 'user');
    if (existing) await sshTestShell.activateWidget(existing.id);
    else await sshTestCommands.executeCommand('terminal:new');
  });
  await page.waitForFunction(() => [...sshTestShell.bottomPanel.widgets()].some(widget => widget.kind === 'user'));
  await page.evaluate(async () => { window.sshTestTerminal = [...sshTestShell.bottomPanel.widgets()].filter(widget => widget.kind === 'user').at(-1); await sshTestTerminal.waitForConnection?.promise; });
}
async function outputContains(text) {
  return page.evaluate(text => { const buffer = sshTestTerminal.getTerminal().buffer.active; return Array.from({length: buffer.length}, (_, i) => buffer.getLine(i)?.translateToString()).join('\n').includes(text); }, text);
}
async function type(text) { await page.evaluate(text => sshTestTerminal.sendText(text), text); }
async function connect(first) {
  await terminal(); await type(`ssh -p ${device.port} tester@127.0.0.1\r`);
  if (first) { await until(() => outputContains('Trust this host'), 'terminal host confirmation'); await type('yes\r'); }
  await until(() => outputContains('password:'), 'terminal password prompt'); await type('test-password\r');
  await until(() => outputContains('TEST SSH READY'), 'remote SSH shell'); console.log('SSH connected from the normal terminal');
}
async function close() {
  await page.evaluate(() => plainEditorDesktop.requestClose()); await until(() => child.exitCode !== null, 'normal close');
  await browser.disconnect(); child.stdout.destroy(); child.stderr.destroy();
}
(async () => {
  device = await fixture(); await launch(); await connect(true);
  await page.waitForSelector('#files .theia-TreeNode[title*="/home/tester/project"]', { visible: true });
  await page.waitForSelector('#files .theia-TreeNode[title*="remote.txt"] .theia-TreeNodeSegmentGrow', { visible: true });
  await page.evaluate(() => { window.sshTestChannel = sshTestConnection.currentChannel; sshTestConnection.socket.disconnect(); });
  await pause(200); await page.evaluate(() => sshTestConnection.socket.connect());
  await page.waitForFunction(() => sshTestConnection.socket.connected);
  assert(await page.evaluate(() => sshTestConnection.currentChannel === sshTestChannel), 'Brief disconnect preserves SSH RPC state');
  await type('echo AFTER_RECONNECT\r');
  await until(() => outputContains('REMOTE: echo AFTER_RECONNECT'), 'remote shell survives editor disconnect');
  await page.$eval('#files .theia-TreeNode[title*="remote.txt"] .theia-TreeNodeSegmentGrow', node => node.click());
  await page.waitForFunction(() => sshTestShell.mainPanel.currentTitle?.owner.editor?.uri.scheme === 'ssh');
  await page.evaluate(() => { const editor = sshTestShell.mainPanel.currentTitle.owner.editor.getControl(); editor.setValue('saved from Singularity over SSH 🪐\n'); editor.focus(); });
  await pause(150); const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'; await page.keyboard.down(modifier); await page.keyboard.press('s'); await page.keyboard.up(modifier);
  await until(() => fs.readFileSync(path.join(device.directory, 'project/remote.txt'), 'utf8') === 'saved from Singularity over SSH 🪐\n', 'Ctrl+S updates remote file');
  await page.evaluate(() => {
    const widget = sshTestShell.mainPanel.currentTitle.owner, resource = widget.editor.document.resource;
    window.sshOriginalSave = resource.saveContents;
    resource.saveContents = async function (...args) {
      window.sshSaveEntered = true;
      await new Promise(resolve => { window.sshReleaseSave = resolve; });
      return sshOriginalSave.apply(this, args);
    };
    widget.editor.getControl().setValue('snapshot sent before newer edits\n');
    window.sshPendingSave = widget.saveable.save();
  });
  await page.waitForFunction(() => window.sshSaveEntered);
  await page.evaluate(async () => {
    const widget = sshTestShell.mainPanel.currentTitle.owner;
    widget.editor.getControl().setValue('newer text typed during the save\n');
    sshReleaseSave(); await sshPendingSave;
    if (!widget.saveable.dirty) throw Error('Newer remote edits must remain unsaved');
    widget.editor.document.resource.saveContents = sshOriginalSave;
  });
  assert.equal(fs.readFileSync(path.join(device.directory, 'project/remote.txt'), 'utf8'), 'snapshot sent before newer edits\n');
  await page.evaluate(async () => {
    const widget = sshTestShell.mainPanel.currentTitle.owner;
    widget.editor.getControl().setValue('saved from Singularity over SSH 🪐\n'); await widget.saveable.save();
  });
  await page.evaluate(() => sshTestShell.mainPanel.currentTitle.owner.editor.getControl().setValue('unsaved remote draft 🪐\n'));
  await until(async () => (await page.evaluate(() => plainEditorDesktop.listRecovery())).entries.some(entry => entry.uri.startsWith('ssh://') && entry.text === 'unsaved remote draft 🪐\n'), 'remote recovery checkpoint');
  await page.evaluate(() => sshTestShell.mainPanel.currentTitle.owner.saveable.revert());
  await until(async () => !(await page.evaluate(() => plainEditorDesktop.listRecovery())).entries.some(entry => entry.uri.startsWith('ssh://')), 'saved remote recovery cleanup');
  await type('echo SSH_TERMINAL_TEST\r'); await until(() => device.shellInput.join('').includes('SSH_TERMINAL_TEST'), 'terminal input reaches remote SSH shell');
  await page.screenshot({ path: path.join(directory, 'remote-editor.png') }); await close();
  await launch();
  await page.$eval('.plain-rail-tools [data-plain-action="files"]', node => node.click());
  await page.waitForFunction(() => document.querySelector('#files')?.innerText.includes('offline'));
  console.log('Remote workspace restored offline without a sign-in dialog');
  await connect(false);
  await page.waitForFunction(() => [...sshTestShell.mainPanel.widgets()].some(widget => widget.editor?.uri.scheme === 'ssh' && widget.editor.document.getText() === 'saved from Singularity over SSH 🪐\n'));
  await close(); console.log('PASS: normal ssh command, terminal sign-in, remote tree, Ctrl+S, SSH shell and restart/reconnect');
})().catch(async error => {
  console.error(error.stack); process.exitCode = 1;
  if (page) { console.error(await page.evaluate(() => document.body.innerText).catch(() => 'closed')); await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); }
}).finally(async () => {
  await browser?.disconnect(); if (child?.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
  child?.stdout.destroy(); child?.stderr.destroy(); await device?.close(); log.end(); console.log('Diagnostics:', directory);
});
