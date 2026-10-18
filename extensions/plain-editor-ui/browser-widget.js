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
      <button type="button" data-browser-action="home" title="Start page" aria-label="Start page">⌂</button>
      <input type="text" aria-label="Web address or Google search" placeholder="Search Google or enter an address" spellcheck="false">
      <button type="submit">Go</button><button type="button" data-browser-action="devtools" title="Developer tools" aria-label="Developer tools" disabled>&lt;/&gt;</button>
    </form><div class="plain-browser-status" role="status">Search Google or open a website or localhost.</div>
    <div class="plain-browser-content"><div class="plain-browser-home">
      <div class="plain-browser-home-heading"><span class="codicon codicon-globe" aria-hidden="true"></span><h2>Browser</h2></div>
      <form class="plain-browser-search"><input type="text" aria-label="Search Google" placeholder="Search Google or enter an address" spellcheck="false"><button type="submit">Search</button></form>
      <div class="plain-browser-history-heading"><p>Saved on this computer</p><button type="button" data-browser-action="clear-history">Clear history</button></div>
      <div class="plain-browser-history-columns"><section><h3>Recently visited</h3><ul data-browser-history="visited"></ul></section><section><h3>Recently closed</h3><ul data-browser-history="closed"></ul></section></div>
    </div></div>`;
    this.address = this.node.querySelector('.plain-browser-toolbar input');
    this.status = this.node.querySelector('.plain-browser-status');
    this.content = this.node.querySelector('.plain-browser-content');
    this.home = this.node.querySelector('.plain-browser-home');
    this.node.querySelector('.plain-browser-toolbar').onsubmit = event => { event.preventDefault(); this.navigate(this.address.value); };
    this.node.querySelector('.plain-browser-search').onsubmit = event => {
      event.preventDefault(); this.navigate(this.node.querySelector('.plain-browser-search input').value);
    };
    this.node.addEventListener('click', event => {
      const action = event.target.closest('[data-browser-action]')?.dataset.browserAction;
      if (action === 'home') this.navigate('about:blank');
      else if (action === 'clear-history') this.loadHistory(true);
      else if (action) this.request(action).catch(error => { this.status.textContent = error.message; });
    });
    this.unsubscribe = window.plainEditorDesktop?.onBrowserState(state => {
      if (state.id !== this.browserId || this.isDisposed) return;
      if (state.url) {
        this.url = state.url;
        if (document.activeElement !== this.address) this.address.value = state.url === 'about:blank' ? '' : state.url;
      }
      this.title.label = state.title || 'Browser';
      this.status.textContent = state.error || (state.loading ? 'Loading…' : state.url === 'about:blank' ? 'Search Google or open a website or localhost.' : state.url);
      this.node.querySelector('[data-browser-action="back"]').disabled = !state.canGoBack;
      this.node.querySelector('[data-browser-action="forward"]').disabled = !state.canGoForward;
      this.home.hidden = this.url !== 'about:blank';
      this.node.querySelector('[data-browser-action="devtools"]').disabled = this.url === 'about:blank';
      this.syncBounds();
    });
    this.unsubscribeHistory = window.plainEditorDesktop?.onBrowserHistory(value => this.renderHistory(value));
    this.unsubscribeShortcut = window.plainEditorDesktop?.onBrowserShortcut(value => {
      if (value.id !== this.browserId) return;
      if (value.action === 'close') this.dispose();
      else if (value.action === 'address') { this.address.focus(); this.address.select(); }
    });
    this.resizeObserver = new ResizeObserver(() => this.syncBounds());
    this.resizeObserver.observe(this.content);
    this.overlays = new MutationObserver(() => this.syncBounds());
    this.overlays.observe(document.body, { attributes: true, attributeFilter: ['open', 'hidden', 'class'], childList: true, subtree: true });
    this.renderHistory({ visited: [], closed: [] });
    this.historyReady = this.loadHistory();
  }
  async loadHistory(clear = false) {
    if (!window.plainEditorDesktop?.browser) return;
    try {
      const value = await window.plainEditorDesktop.browser({ id: this.browserId, action: clear ? 'clear-history' : 'history' });
      if (!this.isDisposed) this.renderHistory(value);
    } catch (error) { if (!this.isDisposed) this.status.textContent = `Could not ${clear ? 'clear' : 'load'} browser history: ${error.message}`; }
  }
  renderHistory(value) {
    if (this.isDisposed) return;
    for (const kind of ['visited', 'closed']) {
      const list = this.node.querySelector(`[data-browser-history="${kind}"]`);
      list.replaceChildren();
      for (const item of (value[kind] || []).slice(0, 8)) {
        const row = document.createElement('li'), button = document.createElement('button');
        const title = document.createElement('span'), address = document.createElement('small');
        button.type = 'button'; button.title = item.url;
        title.textContent = item.title || new URL(item.url).hostname;
        address.textContent = item.url;
        button.append(title, address); button.onclick = () => this.navigate(item.url);
        row.append(button); list.append(row);
      }
      if (!list.children.length) {
        const empty = document.createElement('li'); empty.className = 'plain-browser-history-empty';
        empty.textContent = kind === 'visited' ? 'No visits yet.' : 'No recently closed pages.'; list.append(empty);
      }
    }
    this.node.querySelector('[data-browser-action="clear-history"]').disabled = !value.visited?.length && !value.closed?.length;
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
      if (this.isDisposed) return;
      this.url = result.requestedUrl;
      this.address.value = this.url === 'about:blank' ? '' : this.url;
      this.home.hidden = this.url !== 'about:blank';
      if (!this.home.hidden) this.loadHistory();
      this.syncBounds();
      return result;
    } catch (error) { this.status.textContent = error.message; }
  }
  syncBounds() {
    if (!this.ready || this.isDisposed || this.boundsFrame || (!this.isVisible && !this.nativeVisible)) return;
    this.boundsFrame = requestAnimationFrame(() => { this.boundsFrame = undefined; this.updateBounds(); });
  }
  updateBounds() {
    if (this.isDisposed) return;
    const rect = this.content.getBoundingClientRect();
    const overlay = [...document.querySelectorAll('dialog[open], .dialogBlock, #plain-menu:not([hidden]), #plain-open-menu:not([hidden]), #plain-extension-view-context:not([hidden])')]
      .some(node => node.getBoundingClientRect().width > 0);
    const update = { bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: document.body.classList.contains('plain-session-ready') && this.url !== 'about:blank' && this.isVisible && !overlay };
    const signature = JSON.stringify(update);
    if (signature === this.boundsSignature) return;
    this.boundsSignature = signature;
    this.nativeVisible = update.visible;
    this.request('bounds', update).catch(error => { this.boundsSignature = undefined; if (!this.isDisposed) this.status.textContent = error.message; });
  }
  onAfterAttach(message) {
    super.onAfterAttach(message);
    if (this.url !== 'about:blank') this.initialNavigation = this.navigate(this.url);
  }
  async prepareForStartup() {
    await this.historyReady;
    if (this.url !== 'about:blank') {
      await this.initialNavigation;
      await this.request('ready');
    }
  }
  onAfterShow(message) { super.onAfterShow(message); this.syncBounds(); }
  onActivateRequest(message) { super.onActivateRequest(message); this.address.focus(); }
  onAfterHide(message) { super.onAfterHide(message); this.syncBounds(); }
  onResize(message) { super.onResize(message); this.syncBounds(); }
  storeState() { return { url: this.url }; }
  restoreState(state) { this.url = state.url || 'about:blank'; this.address.value = this.url === 'about:blank' ? '' : this.url; }
  dispose() {
    if (this.isDisposed) return;
    this.unsubscribe?.(); this.unsubscribeHistory?.(); this.unsubscribeShortcut?.(); this.resizeObserver.disconnect(); this.overlays.disconnect();
    if (this.boundsFrame) cancelAnimationFrame(this.boundsFrame);
    if (this.ready) this.ready.then(() => window.plainEditorDesktop.browser({ id: this.browserId, action: 'dispose' }))
      .catch(error => console.error('Singularity: could not finish closing browser', error));
    super.dispose();
  }
}
module.exports = { FACTORY, BrowserWidget };
