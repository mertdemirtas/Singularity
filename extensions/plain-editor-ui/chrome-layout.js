'use strict';

const SIDEBAR_VISIBLE = 'plainEditor.sidebarVisible';
const extensionViewItems = require('./extension-view-items');
const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
const { Sidebar } = require('./sidebar');
const managed = widget => widget.id === 'explorer-view-container' || widget.id === 'scm-view-container' || widget.id === 'vsx-extensions-view-container' || widget.id.startsWith('plugin-view-container:');

module.exports = function createChromeLayout({ shell, preferences, header, titlebar, navigation, viewRegistry, plugins, contextKeys, getOpenPane, openView, openExtensionSettings, openFolder, openSettings, onHideSidebarItem, messages, icon }) {
  let queued = false;
  let iconsDirty = true, geometryDirty = true, paneDirty = true;
  let containerCount = -1, viewCount = -1;
  let containerContexts = new Set(), viewContexts = new Set();
  let moving = false;
  let moveAgain = false;
  const rail = document.createDocumentFragment();
  const controls = new Map();
  let openRequest = 0;
  let iconSignature = '';
  const sidebar = new Sidebar({ header, preferences, messages, openSettings, openExtensionSettings,
    savePreference: (key, value) => preferences.set(key, value, PreferenceScope.User), onHide: onHideSidebarItem });
  const area = () => 'left';
  const positionPopover = (popup, anchor) => {
    if (popup.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const x = rect.right + 8;
    const y = rect.top;
    popup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    popup.style.right = 'auto';
  };

  const closeExtensionContextMenu = () => sidebar.closeMenu();

  const refreshIcons = () => {
    containerCount = viewRegistry.viewContainers.size; viewCount = viewRegistry.views.size;
    containerContexts = new Set([...viewRegistry.viewContainerClauseContexts.values()].flatMap(keys => [...keys]));
    viewContexts = new Set([...viewRegistry.viewClauseContexts.values()].flatMap(keys => [...keys]));
    const views = extensionViewItems(viewRegistry);
    const signature = JSON.stringify(views);
    if (signature === iconSignature) return;
    iconSignature = signature;
    const visible = new Set(views.map(view => view.id));
    for (const [id, control] of controls) {
      if (!visible.has(id)) {
        sidebar.unregister(id); controls.delete(id); closeExtensionContextMenu();
      }
    }
    for (const view of views) {
      let control = controls.get(view.id);
      if (!control) {
        control = document.createElement('button');
        control.type = 'button';
        control.className = 'plain-button plain-icon-only plain-extension-view-item';
        control.dataset.plainView = `plugin-view-container:${view.id}`;
        control.setAttribute('aria-pressed', 'false');
        control.append(document.createElement('span'));
        control.addEventListener('click', async event => {
          event.stopPropagation(); closeExtensionContextMenu();
          const request = ++openRequest;
          control.setAttribute('aria-busy', 'true');
          try {
            // A container can have only conditional views. Waiting for a visible
            // child to activate its extension leaves those containers empty.
            await plugins.activateByViewContainer(view.id);
            if (request !== openRequest) return;
            const widget = await viewRegistry.openViewContainer(view.id);
            if (!widget || request !== openRequest) return;
            const parts = widget.getParts();
            if (parts.every(part => part.isHidden)) {
              const available = parts.find(part => viewRegistry.isViewVisible(part.wrapped.options.viewId));
              if (available) { available.show(); available.collapsed = false; }
            }
            await openView(widget.id);
            schedule();
          } catch (error) {
            console.error('Singularity: open extension view', error);
            messages.error(`Could not open ${view.label}: ${error.message}`);
          } finally { control.removeAttribute('aria-busy'); }
        });
        controls.set(view.id, control);
      }
      control.title = view.label;
      control.setAttribute('aria-label', view.label);
      const glyph = control.firstElementChild;
      const className = `plain-view-icon ${view.iconClass}`;
      if (glyph.className !== className) {
        glyph.className = className;
        glyph.innerHTML = view.iconClass ? '' : icon('extensions');
        glyph.setAttribute('aria-hidden', 'true');
      }
      if (!sidebar.items.has(view.id)) rail.append(control);
      sidebar.register(view.id, control, view.label, true);
    }
    sidebar.refresh();
  };

  // Some extensions intentionally hide every view until a folder, sign-in or
  // other setup step is available. Explain that state without overriding when clauses.
  const emptyView = document.createElement('div');
  emptyView.className = 'plain-extension-view-empty';
  emptyView.hidden = true;
  emptyView.setAttribute('role', 'status');
  const emptyText = document.createElement('p');
  const folderButton = document.createElement('button');
  folderButton.type = 'button'; folderButton.className = 'theia-button'; folderButton.textContent = 'Open Folder';
  folderButton.onclick = () => openFolder().catch(error => messages.error(error.message));
  const extensionSettings = document.createElement('button');
  extensionSettings.type = 'button'; extensionSettings.className = 'theia-button secondary'; extensionSettings.textContent = 'Extension settings';
  extensionSettings.onclick = () => Promise.resolve(openExtensionSettings(emptyView.dataset.containerId)).catch(error => messages.error(error.message));
  emptyView.append(emptyText, folderButton, extensionSettings);
  shell.leftPanelHandler.container.node.append(emptyView);

  const syncGeometry = () => {
    const rows = [...shell.mainPanel.tabBars()].filter(bar => bar.titles.length > 0)
      .map(bar => ({ node: bar.node, rect: bar.node.getBoundingClientRect() })).filter(row => row.rect.width > 0);
    const top = shell.mainPanel.node.getBoundingClientRect().top;
    const navigationRight = rows.length ? navigation.getBoundingClientRect().right : 0;
    // Read geometry together, then write only values that actually changed.
    for (const { node, rect } of rows) {
      const isTop = Math.abs(rect.top - top) < 2;
      node.classList.toggle('plain-window-tabs', isTop && Math.abs(rect.right - innerWidth) < 2);
      const space = `${isTop ? Math.max(0, navigationRight - rect.left) : 0}px`;
      if (node.style.getPropertyValue('--plain-history-space') !== space) node.style.setProperty('--plain-history-space', space);
    }
    titlebar.querySelector('.plain-empty-titlebar').hidden = rows.length > 0;
    titlebar.classList.toggle('plain-compact-titlebar', rows.length > 0);
  };

  const syncPaneState = () => {
    const handler = shell[area() === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'];
    const selected = shell.isExpanded(area()) ? handler.tabBar.currentTitle?.owner.id : '';
    const selectedWidget = selected && shell.getWidgetById(selected);
    const noViews = selected?.startsWith('plugin-view-container:') && selectedWidget?.getParts().every(part => part.isHidden);
    emptyView.hidden = !noViews;
    if (noViews) {
      emptyView.dataset.containerId = viewRegistry.getViewContainerId(selectedWidget);
      const text = `${selectedWidget.title.label} has no views available in the current context. Open a folder or check this extension’s setup requirements.`;
      if (emptyText.textContent !== text) emptyText.textContent = text;
    }
    for (const sideHandler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
      const open = sideHandler.container.node.querySelector('.plain-files-open');
      if (open) open.hidden = sideHandler.tabBar.currentTitle?.owner.id !== 'explorer-view-container';
    }
    for (const { button: control } of sidebar.items.values()) {
      const id = control.dataset.plainView || { files: 'explorer-view-container', extensions: 'vsx-extensions-view-container', 'source-control': 'scm-view-container' }[control.dataset.plainAction];
      if (!id) continue;
      const pressed = String(id === selected);
      if (control.getAttribute('aria-pressed') !== pressed) control.setAttribute('aria-pressed', pressed);
    }
  };
  const syncTitlebar = () => { syncGeometry(); syncPaneState(); };

  const migrateViews = async () => {
    if (moving) { moveAgain = true; return; }
    moving = true;
    const destination = area();
    const selected = getOpenPane();
    let selectedMoved = false;
    let selectedWidth = 280;
    try {
      for (const source of ['left', 'right']) {
        if (source === destination) continue;
        const widgets = shell.getWidgets(source).filter(managed);
        for (const widget of widgets) {
          if (widget.id === selected) {
            selectedMoved = true;
            const handler = shell[source === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'];
            selectedWidth = handler.getLayoutData().size || 280;
          }
          await shell.addWidget(widget, { area: destination, rank: 100 });
        }
        if (widgets.length && shell.isExpanded(source)) await shell.collapsePanel(source);
      }
      if (selected && shell.getWidgetById(selected)) {
        await shell.revealWidget(selected);
        if (selectedMoved) shell[destination === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'].resize(selectedWidth);
        await shell.pendingUpdates;
      } else if (!selected) await shell.collapsePanel(destination);
    } finally {
      moving = false;
      schedule({ icons: true, geometry: true, pane: true });
      if (moveAgain || destination !== area()) {
        moveAgain = false;
        requestAnimationFrame(() => migrateViews().catch(error => console.error('Singularity: sidebar move', error)));
      }
    }
  };

  function schedule({ icons = false, geometry = false, pane = true } = {}) {
    iconsDirty ||= icons; geometryDirty ||= geometry; paneDirty ||= pane;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const updateIcons = iconsDirty, updateGeometry = geometryDirty, updatePane = paneDirty;
      iconsDirty = geometryDirty = paneDirty = false;
      if (updateIcons) refreshIcons();
      if (updateGeometry) syncGeometry();
      if (updatePane || updateIcons) syncPaneState();
    });
  }

  const applyLayout = () => {
    const focused = document.body.classList.contains('plain-focus-mode');
    const visible = preferences.get(SIDEBAR_VISIBLE, true) && !focused;
    document.body.classList.toggle('plain-sidebar-hidden', !preferences.get(SIDEBAR_VISIBLE, true));
    for (const side of ['Left', 'Right', 'Top', 'Bottom']) {
      shell.node.style[`padding${side}`] = visible && side === 'Left' ? '48px' : '0px';
    }
    navigation.style.top = '0px';
    const toggle = navigation.querySelector('[data-plain-action="toggle-sidebar"]');
    toggle.title = visible ? 'Hide sidebar' : 'Show sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-pressed', String(visible));
    for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
      handler.container.node.style.paddingTop = '40px';
      handler.container.fit();
    }
    shell.fit(); shell.update();
    closeExtensionContextMenu();
    migrateViews().catch(error => console.error('Singularity: sidebar layout', error));
    schedule();
  };

  shell.onDidAddWidget(widget => {
    if (managed(widget) && !moving) migrateViews().catch(error => console.error('Singularity: extension view', error));
    schedule({ geometry: true });
  });
  shell.onDidRemoveWidget(() => schedule({ geometry: true }));
  shell.onDidChangeCurrentWidget(() => schedule());
  plugins.onDidChangePlugins(() => schedule({ icons: true }));
  contextKeys.onDidChange(event => {
    const changedContributions = containerCount !== viewRegistry.viewContainers.size || viewCount !== viewRegistry.views.size;
    const icons = changedContributions || event.affects(containerContexts);
    if (icons || event.affects(viewContexts)) schedule({ icons });
  });
  for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) handler.tabBar.currentChanged.connect(() => schedule());
  // Monaco mutates its DOM on every keystroke. Dock-panel layout events cover
  // tab and split changes without rescanning the editor's rendered text.
  shell.mainPanel.layoutModified.connect(() => schedule({ geometry: true }));
  new ResizeObserver(() => schedule({ geometry: true })).observe(shell.mainPanel.node);
  window.addEventListener('resize', () => schedule({ geometry: true }));
  preferences.onPreferenceChanged(change => { if (change.preferenceName === SIDEBAR_VISIBLE) applyLayout(); });
  applyLayout();
  return { applyLayout, positionPopover, closeExtensionContextMenu, syncTitlebar };
};
module.exports.SIDEBAR_VISIBLE = SIDEBAR_VISIBLE;
