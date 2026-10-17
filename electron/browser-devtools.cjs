'use strict';

const { BrowserWindow } = require('electron');

function closeDevTools(view) {
  const tools = view.devtoolsWindow;
  view.devtoolsWindow = undefined;
  if (!view.webContents.isDestroyed() && view.webContents.isDevToolsOpened()) view.webContents.closeDevTools();
  if (tools && !tools.isDestroyed()) tools.destroy();
}

function openDevTools(view, parent) {
  if (view.devtoolsWindow && !view.devtoolsWindow.isDestroyed()) {
    if (view.devtoolsWindow.isMinimized()) view.devtoolsWindow.restore();
    view.devtoolsWindow.show(); view.devtoolsWindow.focus();
    return;
  }
  const tools = new BrowserWindow({
    parent, title: 'Developer Tools — Singularity Browser',
    width: 960, height: 700, minWidth: 480, minHeight: 320,
    show: false, frame: true, transparent: false, backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  tools.setMenu(null);
  view.devtoolsWindow = tools;
  const show = () => { if (!tools.isDestroyed()) { tools.show(); tools.focus(); } };
  view.webContents.once('devtools-opened', show);
  tools.once('closed', () => {
    view.webContents.removeListener('devtools-opened', show);
    if (view.devtoolsWindow === tools) closeDevTools(view);
  });
  // Use an opaque native window with a defined lifetime. Electron's internal
  // detached view otherwise owns its own native surface outside our cleanup.
  view.webContents.setDevToolsWebContents(tools.webContents);
  view.webContents.openDevTools({ mode: 'detach', activate: true });
}

module.exports = { openDevTools, closeDevTools };
