'use strict';

const SIDEBAR_VISIBLE = 'plainEditor.sidebarVisible';
const extensionViewItems = require('./extension-view-items');
const managed = widget => widget.id === 'explorer-view-container' || widget.id === 'scm-view-container' || widget.id === 'vsx-extensions-view-container' || widget.id.startsWith('plugin-view-container:');

module.exports = function createChromeLayout({ shell, preferences, header, titlebar, navigation, viewRegistry, plugins, contextKeys, getOpenPane, openView, openExtensionSettings, icon }) {
  let queued = false;
  let moving = false;
  let moveAgain = false;
  let menuTimer;
  const menu = header.querySelector('#plain-extension-views-menu');
  const overflow = header.querySelector('[data-plain-action="extension-views"]');
  let iconSignature = '';
  const contextMenu = document.createElement('div');
  contextMenu.id = 'plain-extension-view-context';
  contextMenu.setAttribute('role', 'menu');
  contextMenu.hidden = true;
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button'; settingsButton.textContent = 'Extension settings…'; settingsButton.setAttribute('role', 'menuitem');
  contextMenu.append(settingsButton); header.append(contextMenu);
  let settingsView;
  settingsButton.onclick = event => {
    event.stopPropagation(); closeExtensionMenu();
    Promise.resolve(openExtensionSettings(settingsView)).catch(error => console.error('Singularity: extension settings', error));
  };
  contextMenu.addEventListener('pointerenter', () => clearTimeout(menuTimer));

  const area = () => 'left';
  const positionPopover = (popup, anchor) => {
    if (popup.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const x = rect.right + 8;
    const y = popup === menu ? rect.bottom - height : rect.top;
    popup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    popup.style.right = 'auto';
  };

  const closeExtensionMenu = () => {
    clearTimeout(menuTimer);
    menu.hidden = true;
    contextMenu.hidden = true;
    overflow.setAttribute('aria-expanded', 'false');
  };
  const showExtensionMenu = () => {
    refreshIcons();
    clearTimeout(menuTimer);
    menu.hidden = false;
    overflow.setAttribute('aria-expanded', 'true');
    positionPopover(menu, overflow);
  };
  overflow.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch') menuTimer = setTimeout(showExtensionMenu, 150);
  });
  overflow.addEventListener('pointerleave', () => { clearTimeout(menuTimer); menuTimer = setTimeout(closeExtensionMenu, 260); });
  menu.addEventListener('pointerenter', () => clearTimeout(menuTimer));
  menu.addEventListener('pointerleave', () => { if (contextMenu.hidden) menuTimer = setTimeout(closeExtensionMenu, 260); });

  const refreshIcons = () => {
    const views = extensionViewItems(viewRegistry);
    const signature = JSON.stringify(views);
    if (signature === iconSignature) return;
    iconSignature = signature;
    menu.replaceChildren();
    for (const view of views) {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'plain-extension-view-item';
        control.dataset.plainView = `plugin-view-container:${view.id}`;
        control.title = view.label;
        control.setAttribute('aria-label', view.label);
        control.setAttribute('role', 'menuitem');
        const glyph = document.createElement('span');
        glyph.className = `plain-view-icon ${view.iconClass}`;
        if (!view.iconClass) glyph.innerHTML = icon('extensions');
        control.append(glyph);
        const label = document.createElement('span');
        label.textContent = view.label;
        control.append(label);
        control.addEventListener('click', async event => {
          event.stopPropagation(); closeExtensionMenu();
          try {
            const widget = await viewRegistry.openViewContainer(view.id);
            if (widget) await openView(widget.id);
          } catch (error) { console.error('Singularity: open extension view', error); }
        });
        control.addEventListener('contextmenu', event => {
          event.preventDefault(); event.stopPropagation(); clearTimeout(menuTimer);
          settingsView = view.id;
          contextMenu.hidden = false;
          const width = contextMenu.offsetWidth, height = contextMenu.offsetHeight;
          contextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
          contextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
          settingsButton.focus();
        });
        menu.append(control);
    }
    overflow.hidden = false;
    overflow.title = `Extension views (${views.length})`;
    overflow.setAttribute('aria-label', overflow.title);
    if (!views.length) {
      const empty = document.createElement('div');
      empty.className = 'plain-menu-empty';
      empty.textContent = 'No extension sidebar views';
      menu.append(empty);
    }
    if (!menu.hidden) positionPopover(menu, overflow);
  };

  const syncTitlebar = () => {
    const rows = [...shell.mainPanel.tabBars()].filter(bar => bar.titles.length > 0).map(bar => bar.node).filter(node => node.getBoundingClientRect().width > 0);
    const top = shell.mainPanel.node.getBoundingClientRect().top;
    const contentRight = window.innerWidth;
    const navigationRight = navigation.getBoundingClientRect().right;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      row.classList.toggle('plain-window-tabs', Math.abs(rect.top - top) < 2 && Math.abs(rect.right - contentRight) < 2);
      const historySpace = Math.abs(rect.top - top) < 2 ? Math.max(0, navigationRight - rect.left) : 0;
      row.style.setProperty('--plain-history-space', `${historySpace}px`);
    }
    titlebar.querySelector('.plain-empty-titlebar').hidden = rows.length > 0;
    // Keep the transparent overlay confined to the buttons when tabs are present.
    // A wide composited layer can be occluded by an active native side pane.
    titlebar.classList.toggle('plain-compact-titlebar', rows.length > 0);
    const handler = shell[area() === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'];
    const selected = shell.isExpanded(area()) ? handler.tabBar.currentTitle?.owner.id : '';
    for (const sideHandler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
      const open = sideHandler.container.node.querySelector('.plain-files-open');
      if (open) open.hidden = sideHandler.tabBar.currentTitle?.owner.id !== 'explorer-view-container';
    }
    for (const control of header.querySelectorAll('[data-plain-view], .plain-button[data-plain-action="files"], .plain-button[data-plain-action="extensions"], .plain-button[data-plain-action="source-control"]')) {
      const id = control.dataset.plainView || { files: 'explorer-view-container', extensions: 'vsx-extensions-view-container', 'source-control': 'scm-view-container' }[control.dataset.plainAction];
      control.setAttribute('aria-pressed', String(id === selected));
    }
  };

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
      refreshIcons(); syncTitlebar();
      if (moveAgain || destination !== area()) {
        moveAgain = false;
        requestAnimationFrame(() => migrateViews().catch(error => console.error('Singularity: sidebar move', error)));
      }
    }
  };

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refreshIcons(); syncTitlebar();
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
    closeExtensionMenu();
    migrateViews().catch(error => console.error('Singularity: sidebar layout', error));
    schedule();
  };

  shell.onDidAddWidget(widget => {
    if (managed(widget) && !moving) migrateViews().catch(error => console.error('Singularity: extension view', error));
    schedule();
  });
  shell.onDidRemoveWidget(schedule);
  shell.onDidChangeCurrentWidget(schedule);
  plugins.onDidChangePlugins(schedule);
  contextKeys.onDidChange(schedule);
  for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) handler.tabBar.currentChanged.connect(schedule);
  new MutationObserver(schedule).observe(shell.mainPanel.node, { childList: true, subtree: true });
  new ResizeObserver(schedule).observe(shell.mainPanel.node);
  window.addEventListener('resize', schedule);
  preferences.onPreferenceChanged(change => { if (change.preferenceName === SIDEBAR_VISIBLE) applyLayout(); });
  applyLayout();
  return { applyLayout, positionPopover, closeExtensionMenu, toggleExtensionMenu: () => menu.hidden ? showExtensionMenu() : closeExtensionMenu(), syncTitlebar };
};
module.exports.SIDEBAR_VISIBLE = SIDEBAR_VISIBLE;
