'use strict';
const { BaseWidget } = require('@theia/core/lib/browser/widgets/widget');
const FACTORY = 'plain-editor.browser';

class BrowserWidget extends BaseWidget {
  constructor(options) {
    super();
    this.browserId = options.id;
    this.id = `${FACTORY}:${options.id}`;
    this.title.label = 'Browser';
    this.title.iconClass = 'codicon codicon-globe';
    this.title.closable = true;
    this.addClass('plain-browser');
    this.node.tabIndex = 0;
    this.url = 'about:blank';
    this.node.innerHTML = `<form class="plain-browser-toolbar">
      <button type="button" data-browser-action="back" title="Back" aria-label="Back">←</button>
      <button type="button" data-browser-action="forward" title="Forward" aria-label="Forward">→</button>
      <button type="button" data-browser-action="reload" title="Reload" aria-label="Reload">↻</button>
      <input type="text" aria-label="Web address" placeholder="http://localhost:3000 or https://example.com" spellcheck="false">
      <button type="submit">Go</button><button type="button" data-browser-action="devtools" title="Developer tools" aria-label="Developer tools">&lt;/&gt;</button>
    </form><div class="plain-browser-status" role="status">Enter a web address to browse or preview your app.</div>
    <div class="plain-browser-content"><div class="plain-browser-placeholder"><h2>Browser</h2><p>Open a website, localhost, or a server address.</p></div></div>`;
    this.address = this.node.querySelector('input');
    this.status = this.node.querySelector('.plain-browser-status');
    this.content = this.node.querySelector('.plain-browser-content');
    this.node.querySelector('form').onsubmit = event => { event.preventDefault(); this.navigate(this.address.value); };
    this.node.addEventListener('click', event => {
      const action = event.target.closest('[data-browser-action]')?.dataset.browserAction;
      if (action) this.request(action).catch(error => { this.status.textContent = error.message; });
    });
    this.unsubscribe = window.plainEditorDesktop?.onBrowserState(state => {
      if (state.id !== this.browserId || this.isDisposed) return;
      if (state.url && state.url !== 'about:blank') {
        this.url = state.url;
        if (document.activeElement !== this.address) this.address.value = state.url;
      }
      this.title.label = state.title || 'Browser';
      this.status.textContent = state.error || (state.loading ? 'Loading…' : state.url === 'about:blank' ? 'Enter a web address to browse or preview your app.' : state.url);
      this.node.querySelector('[data-browser-action="back"]').disabled = !state.canGoBack;
      this.node.querySelector('[data-browser-action="forward"]').disabled = !state.canGoForward;
    });
    this.unsubscribeShortcut = window.plainEditorDesktop?.onBrowserShortcut(value => {
      if (value.id !== this.browserId) return;
      if (value.action === 'close') this.dispose();
      else if (value.action === 'address') { this.address.focus(); this.address.select(); }
    });
    this.resizeObserver = new ResizeObserver(() => this.syncBounds());
    this.resizeObserver.observe(this.content);
    this.overlays = new MutationObserver(() => this.syncBounds());
    this.overlays.observe(document.body, { attributes: true, attributeFilter: ['open', 'hidden', 'class'], childList: true, subtree: true });
  }
  async ensureView() {
    if (!window.plainEditorDesktop?.browser) throw new Error('The Chromium browser is available in the desktop app.');
    this.ready ||= window.plainEditorDesktop.browser({ id: this.browserId, action: 'create' });
    await this.ready;
  }
  async request(action, extra = {}) {
    await this.ensureView();
    if (this.isDisposed) return;
    return window.plainEditorDesktop.browser({ id: this.browserId, action, ...extra });
  }
  async navigate(url) {
    try {
      const result = await this.request('navigate', { url });
      // Preserve the requested address while the Chromium view is loading.
      this.url = /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`;
      this.address.value = this.url;
      this.content.querySelector('.plain-browser-placeholder').hidden = true;
      this.syncBounds();
      return result;
    } catch (error) { this.status.textContent = error.message; }
  }
  syncBounds() {
    if (!this.ready || this.isDisposed) return;
    const rect = this.content.getBoundingClientRect();
    const overlay = [...document.querySelectorAll('dialog[open], .dialogBlock, #plain-menu:not([hidden]), #plain-open-menu:not([hidden]), #plain-extension-view-context:not([hidden])')]
      .some(node => node.getBoundingClientRect().width > 0);
    this.request('bounds', { bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: this.url !== 'about:blank' && this.isVisible && !overlay }).catch(() => {});
  }
  onAfterAttach(message) {
    super.onAfterAttach(message);
    if (this.url !== 'about:blank') this.navigate(this.url);
  }
  onAfterShow(message) { super.onAfterShow(message); this.syncBounds(); }
  onActivateRequest(message) { super.onActivateRequest(message); this.address.focus(); }
  onAfterHide(message) { super.onAfterHide(message); this.syncBounds(); }
  onResize(message) { super.onResize(message); this.syncBounds(); }
  storeState() { return { url: this.url }; }
  restoreState(state) { this.url = state.url || 'about:blank'; this.address.value = this.url === 'about:blank' ? '' : this.url; }
  dispose() {
    if (this.isDisposed) return;
    this.unsubscribe?.(); this.unsubscribeShortcut?.(); this.resizeObserver.disconnect(); this.overlays.disconnect();
    if (this.ready) this.ready.then(() => window.plainEditorDesktop.browser({ id: this.browserId, action: 'dispose' })).catch(() => {});
    super.dispose();
  }
}
module.exports = { FACTORY, BrowserWidget };
