'use strict';
const { WebContentsView, ipcMain } = require('electron');

function browserUrl(value) {
  const input = String(value || '').trim();
  if (input === 'about:blank') return input;
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS address.');
  return url.href;
}

function installBrowserHost(getWindow) {
  const views = new Map();
  const validId = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
  const state = (id, view, error = '') => {
    const wc = view.webContents;
    return { id, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), error: error || view.loadError || '' };
  };
  const publish = (id, view, error) => {
    if (!view.webContents.isDestroyed()) getWindow()?.webContents.send('plain-editor:browser-state', state(id, view, error));
  };
  ipcMain.handle('plain-editor:browser', async (event, request) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents || !request || !validId(request.id)) throw new Error('Invalid browser request.');
    const { id, action } = request;
    let view = views.get(id);
    if (action === 'create') {
      if (!view) {
        view = new WebContentsView({ webPreferences: {
          partition: 'persist:plain-editor-browser', sandbox: true, contextIsolation: true, nodeIntegration: false
        } });
        views.set(id, view);
        view.setBackgroundColor('#ffffff');
        win.contentView.addChildView(view);
        view.setVisible(false);
        const wc = view.webContents;
        wc.session.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
        wc.on('will-navigate', (navigation, url) => {
          try { browserUrl(url); } catch { navigation.preventDefault(); }
        });
        wc.on('will-redirect', (navigation, url) => {
          try { browserUrl(url); } catch { navigation.preventDefault(); }
        });
        wc.on('before-input-event', (keyboard, input) => {
          const primary = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
          if (input.type !== 'keyDown' || !primary || input.alt || input.shift) return;
          const key = input.key.toLowerCase();
          if (key === 'l' || key === 'w') {
            keyboard.preventDefault();
            win.webContents.focus();
            win.webContents.send('plain-editor:browser-shortcut', { id, action: key === 'l' ? 'address' : 'close' });
          }
        });
        wc.setWindowOpenHandler(({ url }) => {
          try { wc.loadURL(browserUrl(url)).catch(error => publish(id, view, error.message)); } catch { /* unsupported protocol */ }
          return { action: 'deny' };
        });
        wc.on('did-start-loading', () => { view.loadError = ''; publish(id, view); });
        for (const type of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-stop-loading']) wc.on(type, () => publish(id, view));
        wc.on('did-fail-load', (_e, code, description, _url, mainFrame) => {
          if (mainFrame && code !== -3) { view.loadError = description; publish(id, view); }
        });
      }
    }
    if (!view) return undefined;
    const wc = view.webContents;
    if (action === 'navigate') {
      const url = browserUrl(request.url);
      wc.loadURL(url).catch(error => publish(id, view, error.message));
    } else if (action === 'bounds') {
      const bounds = request.bounds;
      if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) throw new Error('Invalid browser bounds.');
      const [width, height] = win.getContentSize();
      const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
      const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
      view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) });
      view.setVisible(Boolean(request.visible && bounds.width > 0 && bounds.height > 0));
    } else if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'stop') wc.stop();
    else if (action === 'devtools') wc.openDevTools({ mode: 'detach' });
    else if (action === 'dispose') {
      win.contentView.removeChildView(view);
      wc.close(); views.delete(id);
      return undefined;
    }
    return state(id, view);
  });
  return { dispose() {
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    views.clear();
  } };
}
module.exports = { installBrowserHost, browserUrl };
