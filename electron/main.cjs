'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { promisify } = require('node:util');
const StateStore = require('./state-store.cjs');
const RecoveryStore = require('./recovery-store.cjs');
const { installBrowserHost } = require('./browser-host.cjs');
const { installedFonts, windowOptions } = require('./platform.cjs');
const { backendRuntime } = require('./runtime.cjs');
const { Updates } = require('./updates.cjs');
const { allocatePort, waitForBackend } = require('./backend-start.cjs');

const execFileAsync = promisify(execFile);

const root = path.resolve(__dirname, '..');
app.setName('Singularity');
if (process.platform === 'linux') app.setDesktopName('singularity.desktop');
if (process.platform === 'win32') app.setAppUserModelId('com.mertdemirtas.singularity');
// Keep existing sessions and browser data available after the product rename.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const legacyProfile = path.join(app.getPath('appData'), 'Plain Editor');
  if (existsSync(legacyProfile)) app.setPath('userData', legacyProfile);
}
let backend;
let mainWindow;
let closeApproved = false;
let closePending = false;
let frontendReady = false;
let recentWrite = Promise.resolve();
let fontFamilies;
let desktopState;
let recovery;
let updatePreparation;
let updates;
function cancelUpdatePreparation() {
  closeApproved = false;
  mainWindow?.webContents.send('plain-editor:update-unlock');
}
async function prepareUpdate() {
  if (!frontendReady || !mainWindow) throw new Error('The editor is still starting');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      updatePreparation = undefined;
      reject(new Error('Timed out preserving open documents'));
    }, 30000);
    updatePreparation = { finish(error) {
      clearTimeout(timer);
      updatePreparation = undefined;
      error ? reject(new Error(error)) : resolve();
    } };
    mainWindow.webContents.send('plain-editor:prepare-update');
  });
  await recoveryStore().flush();
  await stateStore().set('singularity.restoreAfterUpdate', true);
  await stateStore().flush();
  closeApproved = true;
}
const stateStore = () => desktopState ||= new StateStore(path.join(app.getPath('userData'), 'workbench-state.json'));
const recoveryStore = () => recovery ||= new RecoveryStore(path.join(app.getPath('userData'), 'recovery'));
const validStateKey = key => typeof key === 'string' && key.length > 0 && key.length < 16384;
const browserHost = installBrowserHost(() => mainWindow);

async function installedMonoFonts() {
  if (!fontFamilies) {
    fontFamilies = installedFonts(execFileAsync);
  }
  return fontFamilies;
}

function validFileUri(value) {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try {
    const uri = new URL(value);
    if (uri.protocol !== 'file:' || uri.host || uri.search || uri.hash) return undefined;
    fileURLToPath(uri);
    return uri.href;
  } catch {
    return undefined;
  }
}

function recentFilePath() {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

async function readRecentFiles() {
  try {
    const entries = JSON.parse(await fs.readFile(recentFilePath(), 'utf8'));
    return Array.isArray(entries) ? [...new Set(entries.map(validFileUri).filter(Boolean))].slice(0, 12) : [];
  } catch {
    return [];
  }
}

function describeRecentFiles(entries) {
  return entries.map(uri => {
    const filename = fileURLToPath(uri);
    return { uri, name: path.basename(filename), folder: path.dirname(filename) };
  });
}

function updateRecentFiles(change) {
  const result = recentWrite.then(async () => {
    const entries = change(await readRecentFiles()).slice(0, 12);
    const target = recentFilePath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.tmp`, JSON.stringify(entries, null, 2) + '\n');
    await fs.rename(`${target}.tmp`, target);
    return describeRecentFiles(entries);
  });
  recentWrite = result.catch(error => console.error('Singularity: recent files', error));
  return result;
}

function openExternally(url, localOrigin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.origin === localOrigin) return false;
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(url);
  return true;
}

async function start() {
  let savedPort;
  try { savedPort = await stateStore().get('singularity.backendPort'); }
  catch (error) { console.warn('Singularity: could not read cached backend port', error); }
  const port = await allocatePort(savedPort);
  // Chromium cannot navigate to UUID.webview.127.0.0.1 (a hostname ending
  // in an IPv4 address). *.localhost resolves to loopback and preserves each
  // extension webview's isolated origin and secure-context service workers.
  const origin = `http://localhost:${port}`;
  const backendEntry = path.join(root, 'lib/backend/main.js');
  // Theia's native dependencies are built for Node, not Electron's different
  // module ABI. The launcher supplies the exact Node executable used by npm.
  const { node, env } = backendRuntime({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
  env.NODE_COMPILE_CACHE ||= path.join(app.getPath('userData'), 'Cache', 'node');

  backend = spawn(node, [backendEntry, `--port=${port}`, '--hostname=127.0.0.1', '--plugins=local-dir:./plugins'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  backend.stdout.pipe(process.stdout);
  backend.stderr.pipe(process.stderr);
  const backendReady = waitForBackend(backend, port);
  // The stable loopback origin lets Chromium retain compiled frontend code.

  if (process.platform === 'darwin') {
    // AppKit uses a native menu for Command shortcuts, clipboard actions,
    // application hiding, and quitting. Document shortcuts stay in the editor.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
    ]));
    app.dock?.setIcon(path.join(root, 'assets/singularity-icon.png'));
  } else Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    title: 'Singularity',
    icon: path.join(root, 'assets', 'singularity-icon.png'),
    width: 1120,
    height: 760,
    minWidth: 680,
    minHeight: 460,
    resizable: true,
    frame: false,
    ...windowOptions(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      v8CacheOptions: 'bypassHeatCheckAndEagerCompile',
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  mainWindow.on('close', event => {
    if (closeApproved || !frontendReady || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    if (!closePending) {
      closePending = true;
      mainWindow.webContents.send('plain-editor:close-requested');
    }
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.webContents.on('will-prevent-unload', event => {
    // Approved closes have already reviewed documents or durably checkpointed
    // them for an update. The browser's second guard must not trap the restart.
    if (closeApproved) event.preventDefault();
  });
  updates = new Updates({ app, prepare: prepareUpdate, cancelPreparation: cancelUpdatePreparation });
  updates.on('state', state => mainWindow?.webContents.send('plain-editor:update-state', state));
  const sendWindowState = () => mainWindow?.webContents.send('plain-editor:window-state', { maximized: mainWindow.isMaximized() });
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url, origin);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (openExternally(url, origin)) event.preventDefault();
  });

  try {
    await backendReady;
    stateStore().set('singularity.backendPort', port).catch(error => console.warn('Singularity: could not cache backend port', error));
    await mainWindow.loadURL(origin);
  } catch (error) {
    const message = String(error.message).replace(/[<&]/g, character => character === '<' ? '&lt;' : '&amp;');
    const html = `<body style="margin:0;background:#f8f7f5;color:#333;font:16px sans-serif"><div style="height:38px;-webkit-app-region:drag;background:#eee;display:flex;justify-content:space-between;align-items:center;padding-left:12px">Singularity<button onclick="window.plainEditorDesktop.windowAction('close')" style="height:38px;width:42px;border:0;background:transparent;font-size:22px;-webkit-app-region:no-drag" aria-label="Close window">×</button></div><main style="padding:24px"><h1>Singularity could not start</h1><p>${message}</p><p>Run <code>npm run build:release</code> and try again.</p></main></body>`;
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  ipcMain.handle('plain-editor:updates', (event, action) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Update access denied.');
    if (action === 'check') return updates?.check();
    if (action === 'install') return updates?.install();
    return updates?.state;
  });
  ipcMain.on('plain-editor:update-prepared', (event, error) => {
    if (event.sender === mainWindow?.webContents) updatePreparation?.finish(typeof error === 'string' ? error : undefined);
  });
  for (const [action, handler] of [
    ['list', () => recoveryStore().list()],
    ['save', entry => recoveryStore().save(entry)],
    ['remove', id => recoveryStore().remove(id)],
    ['flush', () => recoveryStore().flush()]
  ]) ipcMain.handle(`plain-editor:recovery-${action}`, (event, value) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Recovery access denied.');
    return handler(value);
  });
  ipcMain.handle('plain-editor:read-state', (event, key) => {
    if (event.sender !== mainWindow?.webContents || !validStateKey(key)) return undefined;
    return stateStore().get(key);
  });
  ipcMain.handle('plain-editor:write-state', (event, key, value) => {
    if (event.sender !== mainWindow?.webContents || !validStateKey(key)) return undefined;
    return stateStore().set(key, value);
  });
  ipcMain.handle('plain-editor:flush-state', event => {
    if (event.sender !== mainWindow?.webContents) return undefined;
    return stateStore().flush();
  });
  ipcMain.handle('plain-editor:recent-files', async event => {
    if (event.sender !== mainWindow?.webContents) return [];
    await recentWrite;
    return describeRecentFiles(await readRecentFiles());
  });
  ipcMain.handle('plain-editor:font-families', event =>
    event.sender === mainWindow?.webContents ? installedMonoFonts() : []);
  ipcMain.handle('plain-editor:window-state', event =>
    event.sender === mainWindow?.webContents ? { maximized: mainWindow.isMaximized() } : { maximized: false });
  ipcMain.on('plain-editor:window-action', (event, action) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') mainWindow.close();
  });
  ipcMain.handle('plain-editor:record-recent-file', (event, value) => {
    if (event.sender !== mainWindow?.webContents) return [];
    const uri = validFileUri(value);
    return uri ? updateRecentFiles(entries => [uri, ...entries.filter(entry => entry !== uri)]) : [];
  });
  ipcMain.handle('plain-editor:remove-recent-file', (event, value) => {
    if (event.sender !== mainWindow?.webContents) return [];
    const uri = validFileUri(value);
    return uri ? updateRecentFiles(entries => entries.filter(entry => entry !== uri)) : [];
  });
  ipcMain.handle('plain-editor:clear-recent-files', event =>
    event.sender === mainWindow?.webContents ? updateRecentFiles(() => []) : []);
  ipcMain.on('plain-editor:frontend-ready', event => {
    if (event.sender === mainWindow?.webContents) {
      frontendReady = true;
      updates?.start();
    }
  });
  ipcMain.on('plain-editor:close-reviewed', (event, approved) => {
    if (event.sender !== mainWindow?.webContents) return;
    closePending = false;
    if (approved === true) {
      closeApproved = true;
      mainWindow.close();
    }
  });
  ipcMain.on('plain-editor:request-close', event => {
    if (event.sender === mainWindow?.webContents) mainWindow.close();
  });
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    updates?.dispose();
    browserHost.dispose();
    if (!backend || backend.exitCode !== null) return;
    if (process.platform === 'win32') {
      // Killing only node.exe leaves Windows plugin hosts and terminals alive.
      // Complete this before Electron exits: the installer must be able to
      // replace the bundled node.exe, which Windows locks while it is running.
      try {
        execFileSync('taskkill.exe', ['/PID', String(backend.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
      } catch (error) {
        console.error('Singularity backend cleanup:', error.message);
        backend.kill();
      }
    } else backend.kill();
  });
}
