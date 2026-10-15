'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plainEditorDesktop', {
  platform: process.platform,
  browser(request) { return ipcRenderer.invoke('plain-editor:browser', request); },
  onBrowserState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('plain-editor:browser-state', listener);
    return () => ipcRenderer.removeListener('plain-editor:browser-state', listener);
  },
  onBrowserShortcut(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('plain-editor:browser-shortcut', listener);
    return () => ipcRenderer.removeListener('plain-editor:browser-shortcut', listener);
  },
  readState(key) { return ipcRenderer.invoke('plain-editor:read-state', key); },
  writeState(key, value) { return ipcRenderer.invoke('plain-editor:write-state', key, value); },
  flushState() { return ipcRenderer.invoke('plain-editor:flush-state'); },
  onCloseRequested(callback) {
    if (typeof callback === 'function') {
      ipcRenderer.on('plain-editor:close-requested', () => callback());
    }
  },
  closeReviewed(approved) {
    ipcRenderer.send('plain-editor:close-reviewed', approved === true);
  },
  requestClose() {
    ipcRenderer.send('plain-editor:request-close');
  },
  ready() {
    ipcRenderer.send('plain-editor:frontend-ready');
  },
  windowAction(action) {
    ipcRenderer.send('plain-editor:window-action', action);
  },
  windowState() {
    return ipcRenderer.invoke('plain-editor:window-state');
  },
  onWindowStateChanged(callback) {
    if (typeof callback === 'function') {
      ipcRenderer.on('plain-editor:window-state', (_event, state) => callback(state));
    }
  },
  fontFamilies() {
    return ipcRenderer.invoke('plain-editor:font-families');
  },
  recentFiles() {
    return ipcRenderer.invoke('plain-editor:recent-files');
  },
  recordRecentFile(uri) {
    return ipcRenderer.invoke('plain-editor:record-recent-file', uri);
  },
  removeRecentFile(uri) {
    return ipcRenderer.invoke('plain-editor:remove-recent-file', uri);
  },
  clearRecentFiles() {
    return ipcRenderer.invoke('plain-editor:clear-recent-files');
  }
});
