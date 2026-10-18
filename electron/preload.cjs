'use strict';

const { contextBridge, ipcRenderer } = require('electron');
let startupAppearance;
try {
  const value = process.argv.find(argument => argument.startsWith('--singularity-appearance='));
  if (value) startupAppearance = JSON.parse(Buffer.from(value.slice('--singularity-appearance='.length), 'base64').toString('utf8'));
} catch (error) { console.warn('Singularity: invalid startup appearance', error); }

contextBridge.exposeInMainWorld('plainEditorDesktop', {
  platform: process.platform,
  startupAppearance,
  exportPdf(request) { return ipcRenderer.invoke('plain-editor:export-pdf', request); },
  updates(action) { return ipcRenderer.invoke('plain-editor:updates', action); },
  onUpdateState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('plain-editor:update-state', listener);
    return () => ipcRenderer.removeListener('plain-editor:update-state', listener);
  },
  onPrepareUpdate(callback) { ipcRenderer.on('plain-editor:prepare-update', () => callback()); },
  updatePrepared(error) { ipcRenderer.send('plain-editor:update-prepared', error); },
  onUpdateUnlock(callback) { ipcRenderer.on('plain-editor:update-unlock', () => callback()); },
  listRecovery() { return ipcRenderer.invoke('plain-editor:recovery-list'); },
  saveRecovery(entry) { return ipcRenderer.invoke('plain-editor:recovery-save', entry); },
  removeRecovery(id) { return ipcRenderer.invoke('plain-editor:recovery-remove', id); },
  flushRecovery() { return ipcRenderer.invoke('plain-editor:recovery-flush'); },
  browser(request) { return ipcRenderer.invoke('plain-editor:browser', request); },
  onBrowserHistory(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('plain-editor:browser-history', listener);
    return () => ipcRenderer.removeListener('plain-editor:browser-history', listener);
  },
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
