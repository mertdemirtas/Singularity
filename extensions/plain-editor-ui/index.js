'use strict';

const { ContainerModule } = require('@theia/core/shared/inversify');
const { FrontendApplicationContribution } = require('@theia/core/lib/browser/frontend-application-contribution');
const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
const { TabBarToolbarContribution } = require('@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar-registry');
const { CommandRegistry, CommandContribution } = require('@theia/core/lib/common/command');
const { MessageService } = require('@theia/core/lib/common/message-service');
const URI = require('@theia/core/lib/common/uri').default;
const { EditorManager } = require('@theia/editor/lib/browser/editor-manager');
const { PreferenceService } = require('@theia/core/lib/common/preferences/preference-service');
const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
const { ThemeService } = require('@theia/core/lib/browser/theming');
const { WindowService } = require('@theia/core/lib/browser/window/window-service');
const { StopReason } = require('@theia/core/lib/common/frontend-application-state');
const { FileDialogService } = require('@theia/filesystem/lib/browser/file-dialog/file-dialog-service');
const { WorkspaceService } = require('@theia/workspace/lib/browser/workspace-service');
const { PreferenceContribution, PreferenceSchemaService } = require('@theia/core/lib/common/preferences/preference-schema');
const { Emitter } = require('@theia/core/lib/common/event');
const { PluginViewRegistry } = require('@theia/plugin-ext/lib/main/browser/view/plugin-view-registry');
const { HostedPluginSupport } = require('@theia/plugin-ext/lib/hosted/browser/hosted-plugin');
const { ContextKeyService } = require('@theia/core/lib/browser/context-key-service');
const { LocalStorageService } = require('@theia/core/lib/browser/storage-service');
const { ShellLayoutRestorer } = require('@theia/core/lib/browser/shell/shell-layout-restorer');
const { WidgetFactory, WidgetManager } = require('@theia/core/lib/browser/widget-manager');
const welcome = require('./welcome');
const { OpenerService, open: openResource } = require('@theia/core/lib/browser/opener-service');
const { VSXExtensionsModel } = require('@theia/vsx-registry/lib/browser/vsx-extensions-model');
const extensionViewOwner = require('./extension-view-owner');
const createChromeLayout = require('./chrome-layout');
const { SIDEBAR_VISIBLE } = createChromeLayout;
const AppHistory = require('./app-history');
const focusChanged = new Emitter();

const icons = {
  document: '<path d="M6 2.75h7l4 4V21H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v4h4M8 11h6M8 15h6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>',
  save: '<path d="M4 3h13l3 3v15H4Z"/><path d="M8 3v6h8V3M8 21v-8h8v8"/>',
  files: '<path d="M6 4h12v15H6zM9 2h9M4 7H2v15h13v-2"/>',
  terminal: '<path d="m4 7 5 5-5 5M11 18h9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.5-.7-1.6 1-1.8-2.2-2.2-1.8 1-1.6-.7-.5-2h-3l-.5 2-1.6.7-1.8-1-2.2 2.2 1 1.8-.7 1.6-2 .5v3l2 .5.7 1.6-1 1.8 2.2 2.2 1.8-1 1.6.7.5 2h3l.5-2 1.6-.7 1.8 1 2.2-2.2-1-1.8.7-1.6Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  focus: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  extensions: '<path d="M8 3h4v4a2 2 0 1 0 4 0V3h5v6h-4a2 2 0 1 0 0 4h4v8h-8v-4a2 2 0 1 0-4 0v4H3v-8h4a2 2 0 1 0 0-4H3V3h5Z"/>',
  views: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  pane: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M17.5 8h1M17.5 12h1M17.5 16h1"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  forward: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  git: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10M18 7v2a6 6 0 0 1-6 6H6"/>'
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

function button(label, symbol, action, extra = '') {
  return `<button type="button" class="plain-button ${extra}" data-plain-action="${action}" title="${label}" aria-label="${label}">${icon(symbol)}<span>${label}</span></button>`;
}

function fontName(value) {
  return String(value || '').trim() || 'monospace';
}

function buildHeader() {
  const header = document.createElement('header');
  header.id = 'plain-header';
  header.setAttribute('aria-label', 'App sidebar');
  header.innerHTML = `
    <div class="plain-rail-tools">
      ${button('Files', 'files', 'files', 'plain-icon-only')}
      ${button('Source Control', 'git', 'source-control', 'plain-icon-only')}
    </div>
    <div class="plain-rail-footer">
      ${button('Extensions', 'extensions', 'extensions', 'plain-icon-only')}
      ${button('Extension views', 'views', 'extension-views', 'plain-icon-only')}
      ${button('Terminal', 'terminal', 'terminal', 'plain-icon-only plain-hide-in-focus')}
      ${button('Menu', 'menu', 'menu', 'plain-icon-only plain-hide-in-focus')}
    </div>
    <div id="plain-extension-views-menu" role="menu" aria-label="Extension views" hidden></div>
    <div id="plain-menu" role="menu" hidden>
      <button type="button" role="menuitem" data-plain-action="save-as">Save As…</button>
      <button type="button" role="menuitem" data-plain-action="save-all">Save All</button>
      <button type="button" role="menuitem" data-plain-action="reopen-closed">Reopen Closed Tab</button>
      <button type="button" role="menuitem" data-plain-action="terminal">Terminal</button>
      <button type="button" role="menuitem" data-plain-action="settings">Settings…</button>
      <button type="button" role="menuitem" data-plain-action="browser">Browser</button>
      <button type="button" role="menuitem" data-plain-action="source-control">Source Control</button>
      <button type="button" role="menuitem" data-plain-action="development">Development tools…</button>
      ${window.plainEditorDesktop ? '<button type="button" role="menuitem" data-plain-action="quit">Quit</button>' : ''}
    </div>`;
  document.body.append(header);
  return header;
}

function buildOpenMenu() {
  const menu = document.createElement('div');
  menu.id = 'plain-open-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = `<button type="button" role="menuitem" data-plain-action="open-file">Open File…</button>
    <button type="button" role="menuitem" data-plain-action="open-folder">Open Folder…</button>
    ${window.plainEditorDesktop ? '<div class="plain-menu-label">Recent files</div><div id="plain-recent-files"></div><button type="button" role="menuitem" data-plain-action="clear-recent">Clear Recent Files</button>' : ''}`;
  document.body.append(menu);
  return menu;
}

function buildTitlebar() {
  const titlebar = document.createElement('div');
  titlebar.id = 'plain-titlebar';
  // Keep window controls above independently composited editor/extension views.
  titlebar.setAttribute('popover', 'manual');
  titlebar.innerHTML = `<div class="plain-empty-titlebar">
    <span>Plain Editor</span><div class="plain-empty-actions">
      ${button('New file', 'add', 'new', 'plain-icon-only')}
      ${button('Focus mode', 'focus', 'focus', 'plain-icon-only')}
    </div></div>
    ${window.plainEditorDesktop ? `<div class="plain-window-controls">
      ${button('Minimize', 'minus', 'minimize', 'plain-icon-only')}
      ${button('Maximize', 'square', 'maximize', 'plain-icon-only')}
      ${button('Close window', 'close', 'window-close', 'plain-icon-only plain-window-close')}
    </div>` : ''}`;
  document.body.append(titlebar);
  titlebar.showPopover();
  return titlebar;
}

function buildNavigation() {
  const navigation = document.createElement('nav');
  navigation.id = 'plain-app-navigation';
  navigation.setAttribute('aria-label', 'App navigation');
  navigation.setAttribute('popover', 'manual');
  navigation.innerHTML = `${button('Back (Alt+Left)', 'back', 'back', 'plain-icon-only')}
    ${button('Forward (Alt+Right)', 'forward', 'forward', 'plain-icon-only')}
    ${button('Hide sidebar', 'sidebar', 'toggle-sidebar', 'plain-icon-only')}`;
  document.body.append(navigation);
  navigation.showPopover();
  return navigation;
}

function buildSettings() {
  const dialog = document.createElement('dialog');
  dialog.id = 'plain-settings';
  dialog.setAttribute('aria-labelledby', 'plain-settings-title');
  dialog.innerHTML = `
    <div class="plain-settings-header"><h2 id="plain-settings-title">Settings</h2><button type="button" data-settings-action="close" aria-label="Close settings" title="Close settings">×</button></div>
    <div class="plain-settings-body">
      <section><h3>Appearance</h3>
        <label class="plain-check"><input id="plain-sidebar-visible" data-preference="${SIDEBAR_VISIBLE}" type="checkbox"><span>Show sidebar</span></label>
        <label for="plain-theme">Theme</label><select id="plain-theme" data-preference="workbench.colorTheme"></select>
        <label for="plain-font">Font family</label><select id="plain-font" data-preference="editor.fontFamily"></select>
        <label for="plain-font-size">Editor font size</label><div class="plain-number-field"><input id="plain-font-size" data-preference="editor.fontSize" type="number" min="8" max="48" step="1"><span>px</span></div>
      </section>
      <section><h3>Files and editing</h3>
        <label for="plain-auto-save">Auto save</label><select id="plain-auto-save" data-preference="files.autoSave"><option value="onWindowChange">When app window loses focus</option><option value="onFocusChange">When editor loses focus</option><option value="afterDelay">After a delay</option><option value="off">Off</option></select>
        <div id="plain-delay-row"><label for="plain-auto-save-delay">Delay</label><div class="plain-number-field"><input id="plain-auto-save-delay" data-preference="files.autoSaveDelay" type="number" min="0" max="60000" step="100"><span>ms</span></div></div>
        <label class="plain-check"><input id="plain-minimap" data-preference="editor.minimap.enabled" type="checkbox"><span>Show code minimap</span></label>
        <label class="plain-check"><input id="plain-wrap" data-preference="editor.wordWrap" type="checkbox"><span>Wrap long lines</span></label>
      </section>
    </div>
    <div class="plain-settings-footer"><button type="button" data-settings-action="all">All settings</button><button type="button" data-settings-action="json">Open user settings.json</button></div>`;
  document.body.append(dialog);
  return dialog;
}

module.exports = new ContainerModule((bind, unbind, isBound, rebind) => {
  if (window.plainEditorDesktop) rebind(LocalStorageService).toConstantValue({
    getData: async (key, fallback) => {
      const value = await window.plainEditorDesktop.readState(key);
      return value === undefined ? fallback : value;
    },
    setData: (key, value) => window.plainEditorDesktop.writeState(key, value)
  });
  bind(WidgetFactory).toConstantValue({ id: welcome.ID, createWidget: () => welcome.createWelcome(icon) });
  require('./extensions-panel')(bind);
  require('./development-tools')(bind);
  bind(PreferenceContribution).toConstantValue({ schema: {
    type: 'object', properties: {
      [SIDEBAR_VISIBLE]: { type: 'boolean', default: true, description: 'Show the sidebar and its open side pane.' }
    }
  } });
  bind(TabBarToolbarContribution).toDynamicValue(({ container }) => {
    const shell = container.get(ApplicationShell);
    return {
      registerToolbarItems(registry) {
        registry.registerItem({
          id: 'plain-editor.new-file',
          command: 'workbench.action.files.newUntitledFile',
          icon: 'codicon codicon-add',
          tooltip: 'New file',
          group: 'navigation',
          priority: -100,
          isVisible: widget => Boolean(widget && shell.getAreaFor(widget) === 'main')
        });
        for (const [id, command, icon, tooltip, priority] of [
          ['split-right', 'plain-editor.split-right', 'codicon codicon-split-horizontal', 'Split editor right', -90],
          ['split-down', 'plain-editor.split-down', 'codicon codicon-split-vertical', 'Split editor down', -80]
        ]) registry.registerItem({
          id: `plain-editor.${id}`, command, icon, tooltip,
          group: 'navigation', priority, onDidChange: focusChanged.event,
          isVisible: widget => Boolean(widget && shell.getAreaFor(widget) === 'main' && !document.body.classList.contains('plain-focus-mode'))
        });
        for (const [id, command, glyph, tooltip, priority] of [
          ['focus', 'plain-editor.focus', 'codicon codicon-eye', 'Focus mode', -60]
        ]) registry.registerItem({ id: `plain-editor.${id}`, command, icon: glyph, tooltip, group: 'navigation', priority,
          onDidChange: focusChanged.event,
          isVisible: widget => Boolean(widget && shell.getAreaFor(widget) === 'main')
        });
      }
    };
  }).inSingletonScope();

  bind(CommandContribution).toDynamicValue(({ container }) => {
    const editors = container.get(EditorManager);
    return {
      registerCommands(registry) {
        for (const [id, event] of [['focus', 'plain-toggle-focus'], ['toggle-pane', 'plain-toggle-pane'], ['toggle-sidebar', 'plain-toggle-sidebar']]) {
          registry.registerCommand({ id: `plain-editor.${id}` }, {
            execute: () => window.dispatchEvent(new Event(event)),
            isToggled: () => id === 'focus' && document.body.classList.contains('plain-focus-mode')
          });
        }
        for (const [direction, mode] of [['right', 'split-right'], ['down', 'split-bottom']]) {
          registry.registerCommand({ id: `plain-editor.split-${direction}` }, {
            isEnabled: widget => Boolean(widget?.editor || editors.currentEditor),
            execute: async widget => {
              const current = widget?.editor ? widget : editors.currentEditor;
              if (!current) return;
              const state = current.editor.storeViewState();
              const next = await editors.openToSide(current.editor.uri, {
                selection: current.editor.selection,
                widgetOptions: { mode, ref: current }
              });
              next.editor.restoreViewState(state);
            }
          });
        }
      }
    };
  }).inSingletonScope();

  bind(FrontendApplicationContribution).toDynamicValue(({ container }) => {
    require('./file-navigation')(container);
    const commands = container.get(CommandRegistry);
    const messages = container.get(MessageService);
    const editorManager = container.get(EditorManager);
    const preferences = container.get(PreferenceService);
    const preferenceSchema = container.get(PreferenceSchemaService);
    const themes = container.get(ThemeService);
    const windowService = container.get(WindowService);
    const fileDialog = container.get(FileDialogService);
    const workspace = container.get(WorkspaceService);
    const widgets = container.get(WidgetManager);
    const layoutRestorer = container.get(ShellLayoutRestorer);
    const openers = container.get(OpenerService);
    const plugins = container.get(HostedPluginSupport);
    let shell;
    let menu;
    let openMenu;
    let openAnchor;
    let header;
    let titlebar;
    let navigation;
    let chrome;
    let settings;
    let availableFonts = ['monospace', 'Ubuntu Mono', 'DejaVu Sans Mono', 'JetBrains Mono', 'Fira Code'];
    let recentFiles = [];
    let focusMode = false;
    let focusPanels = [];
    let pinnedSide = '';
    let previewSide = '';
    let hoverTimer;
    let lastSide = 'explorer-view-container';
    const sizedAreas = new Set();
    const history = new AppHistory();
    let navigating = false;
    const historyTarget = id => {
      const widget = shell?.getWidgetById(id);
      return widget && !widget.isDisposed && shell.getAreaFor(widget) === 'main' ? widget : undefined;
    };
    const syncNavigation = () => {
      if (!navigation) return;
      for (const [action, direction, key] of [['back', -1, 'Left'], ['forward', 1, 'Right']]) {
        const control = navigation.querySelector(`[data-plain-action="${action}"]`);
        const index = history.find(direction, historyTarget);
        const target = index === -1 ? undefined : historyTarget(history.entries[index]);
        const label = action === 'back' ? 'Back' : 'Forward';
        control.disabled = navigating || !target;
        control.title = `${label}${target ? ` to ${target.title.label}` : ''} (Alt+${key})`;
        control.setAttribute('aria-label', control.title);
      }
    };
    const recordNavigation = (widget = shell?.mainPanel.currentTitle?.owner) => {
      if (navigating || !widget || !historyTarget(widget.id)) return;
      history.visit(widget.id);
      syncNavigation();
    };
    const navigate = async direction => {
      if (navigating) return;
      const previousIndex = history.index;
      const id = history.go(direction, historyTarget);
      if (!id) return;
      navigating = true;
      syncNavigation();
      try {
        // Activation is asynchronous. Keep its focus/selection events out of
        // history so they cannot erase the Forward branch or record a split's
        // previously selected tab while focus is still moving.
        const activated = await shell.activateWidget(id);
        if (!activated) history.index = previousIndex;
      } catch (error) {
        history.index = previousIndex;
        console.error('Plain Editor: tab navigation', error);
      } finally { navigating = false; syncNavigation(); }
    };
    const panelArea = () => 'left';
    let terminalFontDefault;
    let terminalFontFamily;
    const syncFont = () => {
      const family = fontName(preferences.get('editor.fontFamily', 'monospace'));
      // Set inherited variables on the body, so lazy editor styles and newly
      // created panes cannot replace the selected font with platform defaults.
      for (const name of ['--theia-ui-font-family', '--theia-code-font-family', '--theia-monospace-font-family']) {
        document.body.style.setProperty(name, family);
      }
      // Theia copies the editor's original default into the terminal schema.
      // Keep that default in sync without overwriting an explicit terminal font.
      if (terminalFontFamily !== family) {
        terminalFontFamily = family;
        const previous = terminalFontDefault;
        terminalFontDefault = preferenceSchema.registerOverride('terminal.integrated.fontFamily', undefined, family);
        previous?.dispose();
      }
    };
    const execute = id => commands.executeCommand(id).catch(error => console.error(`Plain Editor: ${id}`, error));
    const closeMenu = () => {
      if (menu && !menu.hidden) {
        menu.hidden = true;
        header.querySelector('[data-plain-action="menu"]').setAttribute('aria-expanded', 'false');
      }
      if (openMenu && !openMenu.hidden) {
        openMenu.hidden = true;
        openAnchor?.setAttribute('aria-expanded', 'false');
      }
      chrome?.closeExtensionMenu();
    };
    const toggleFocus = async () => {
      focusMode = !focusMode;
      document.body.classList.toggle('plain-focus-mode', focusMode);
      const label = focusMode ? 'Show controls' : 'Focus mode';
      for (const control of document.querySelectorAll('[data-plain-action="focus"], [id="plain-editor.focus"]')) {
        control.title = label;
        control.setAttribute('aria-label', label);
        control.setAttribute('aria-pressed', String(focusMode));
      }
      if (focusMode) {
        closeMenu();
        clearTimeout(hoverTimer);
        previewSide = '';
        document.body.classList.remove('plain-side-peek');
        focusPanels = ['left', 'right', 'bottom'].filter(area => shell.isExpanded(area));
        for (const area of focusPanels) await shell.collapsePanel(area);
      } else {
        for (const area of focusPanels) shell.expandPanel(area);
        focusPanels = [];
      }
      chrome?.applyLayout();
      focusChanged.fire();
    };
    const sideWidgets = { files: 'explorer-view-container', extensions: 'vsx-extensions-view-container' };
    const closePreview = async () => {
      clearTimeout(hoverTimer);
      if (!previewSide) return;
      previewSide = '';
      document.body.classList.remove('plain-side-peek');
      if (!pinnedSide) await shell.collapsePanel(panelArea());
    };
    const openSide = async (name, preview = false) => {
      if (!preferences.get(SIDEBAR_VISIBLE, true)) {
        if (preview) return;
        await preferences.set(SIDEBAR_VISIBLE, true, PreferenceScope.User);
      }
      if (focusMode) {
        if (preview) return;
        await toggleFocus();
      }
      const id = sideWidgets[name] || name;
      const area = panelArea();
      clearTimeout(hoverTimer);
      if (preview && pinnedSide) return;
      if (!preview && !navigating && pinnedSide === id && shell.isExpanded(area)) {
        pinnedSide = '';
        await closePreview();
        await shell.collapsePanel(area);
        return;
      }
      if (!preview) {
        pinnedSide = id;
        previewSide = '';
        document.body.classList.remove('plain-side-peek');
      } else {
        previewSide = id;
        document.body.classList.add('plain-side-peek');
      }
      try {
        const widget = shell.getWidgetById(id);
        if (widget && shell.getAreaFor(widget) !== area) await shell.addWidget(widget, { area, rank: 100 });
        await shell.revealWidget(id);
        if (!preview) shell.activateWidget(id);
        if (preview && previewSide !== id) {
          if (!pinnedSide) await shell.collapsePanel(area);
          return;
        }
        lastSide = id;
        shell.expandPanel(area);
        const handler = shell[area === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'];
        if (!sizedAreas.has(area)) {
          if ((handler.getLayoutData().size || 0) < 220) handler.resize(280);
          sizedAreas.add(area);
        }
      } catch (error) {
        console.error(`Plain Editor: open ${name}`, error);
      }
    };
    const openFolder = async () => {
      try {
        const [root] = await workspace.roots;
        const uri = await fileDialog.showOpenDialog({
          title: 'Open Folder', canSelectFolders: true, canSelectFiles: false
        }, root);
        if (!uri) return;
        if (!workspace.workspace?.resource.isEqual(uri)) {
          sessionStorage.setItem('plain-show-files-after-folder', '1');
          workspace.open(uri, { preserveWindow: true });
        } else await openSide('files');
      } catch (error) {
        console.error('Plain Editor: open folder', error);
        messages.error('Could not open the folder.');
      }
    };
    const actions = {
      new: () => execute('workbench.action.files.newUntitledFile'),
      open: control => {
        const show = openMenu.hidden;
        closeMenu();
        openAnchor = control;
        clearTimeout(hoverTimer);
        pinnedSide = 'explorer-view-container';
        previewSide = '';
        document.body.classList.remove('plain-side-peek');
        openMenu.hidden = !show;
        openAnchor.setAttribute('aria-expanded', String(show));
        if (show) {
          chrome.positionPopover(openMenu, openAnchor);
          refreshRecentFiles().then(() => chrome.positionPopover(openMenu, openAnchor));
        }
      },
      'open-file': () => { closePreview(); execute('workspace:openFile'); },
      save: () => execute('core.save'),
      'save-as': () => execute('file.saveAs'),
      'save-all': () => execute('core.saveAll'),
      'reopen-closed': () => execute('workbench.action.reopenClosedEditor'),
      'settings-json': () => execute('workbench.action.openSettingsJson'),
      'open-folder': openFolder,
      focus: toggleFocus,
      back: () => navigate(-1),
      forward: () => navigate(1),
      'toggle-sidebar': async () => {
        closeMenu(); clearTimeout(hoverTimer); await closePreview();
        if (focusMode) { await toggleFocus(); await preferences.set(SIDEBAR_VISIBLE, true, PreferenceScope.User); }
        else await preferences.set(SIDEBAR_VISIBLE, !preferences.get(SIDEBAR_VISIBLE, true), PreferenceScope.User);
      },
      minimize: () => window.plainEditorDesktop?.windowAction('minimize'),
      maximize: () => window.plainEditorDesktop?.windowAction('maximize'),
      'window-close': () => window.plainEditorDesktop?.windowAction('close'),
      files: () => openSide('files'),
      extensions: () => openSide('extensions'),
      'extension-views': () => chrome.toggleExtensionMenu(),
      browser: () => execute('plain-editor.browser'),
      development: () => execute('plain-editor.development'),
      'source-control': async () => {
        const widget = await widgets.getOrCreateWidget('scm-view-container');
        if (!widget.isAttached) await shell.addWidget(widget, { area: panelArea() });
        await openSide(widget.id);
      },
      'toggle-pane': async () => {
        closeMenu();
        if (focusMode) {
          await toggleFocus();
          if (shell.isExpanded(panelArea())) return;
        }
        if (shell.isExpanded(panelArea())) {
          pinnedSide = ''; previewSide = ''; clearTimeout(hoverTimer);
          document.body.classList.remove('plain-side-peek');
          await shell.collapsePanel(panelArea());
        } else await openSide(lastSide);
      },
      terminal: async () => {
        if (shell.isExpanded('bottom')) await shell.collapsePanel('bottom');
        else {
          const existing = [...shell.bottomPanel.widgets()].find(widget => widget.id.startsWith('terminal-'));
          if (existing) await shell.activateWidget(existing.id);
          else await execute('terminal:new');
        }
      },
      settings: () => {
        syncSettings();
        if (!settings.open) settings.showModal();
        if (window.plainEditorDesktop) window.plainEditorDesktop.fontFamilies().then(families => {
          availableFonts = families;
          syncFontOptions();
        }).catch(error => console.error('Plain Editor: font list', error));
      },
      quit: () => window.plainEditorDesktop?.requestClose(),
      'clear-recent': async () => {
        recentFiles = await window.plainEditorDesktop.clearRecentFiles();
        renderRecentFiles();
      },
      menu: () => {
        const show = menu.hidden;
        closeMenu();
        menu.hidden = !show;
        header.querySelector('[data-plain-action="menu"]').setAttribute('aria-expanded', String(show));
        if (show) chrome.positionPopover(menu, header.querySelector('[data-plain-action="menu"]'));
      }
    };
    const renderRecentFiles = () => {
      const list = openMenu.querySelector('#plain-recent-files');
      if (!list) return;
      list.replaceChildren();
      if (!recentFiles.length) {
        const empty = document.createElement('div');
        empty.className = 'plain-menu-empty';
        empty.textContent = 'No recent files';
        list.append(empty);
      }
      for (const [index, entry] of recentFiles.entries()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'plain-recent-file';
        item.dataset.recentIndex = String(index);
        item.setAttribute('role', 'menuitem');
        item.title = `${entry.name} — ${entry.folder}`;
        const name = document.createElement('span');
        name.textContent = entry.name;
        const folder = document.createElement('small');
        folder.textContent = entry.folder;
        item.append(name, folder);
        list.append(item);
      }
      openMenu.querySelector('[data-plain-action="clear-recent"]').hidden = !recentFiles.length;
    };
    const refreshRecentFiles = async () => {
      if (!window.plainEditorDesktop) return;
      try {
        recentFiles = await window.plainEditorDesktop.recentFiles();
        renderRecentFiles();
      } catch (error) {
        console.error('Plain Editor: recent files', error);
      }
    };
    const openRecentFile = async index => {
      const entry = recentFiles[index];
      if (!entry) return;
      try {
        await openResource(openers, new URI(entry.uri));
        closePreview();
      } catch (error) {
        console.error('Plain Editor: open recent file', error);
        messages.error(`Could not open ${entry.name}.`);
        recentFiles = await window.plainEditorDesktop.removeRecentFile(entry.uri);
        renderRecentFiles();
      }
    };
    const syncFontOptions = () => {
      const selected = fontName(preferences.get('editor.fontFamily', 'monospace'));
      const names = [...new Set(['monospace', ...availableFonts, selected])].sort((a, b) => a.localeCompare(b));
      const select = settings.querySelector('#plain-font');
      select.replaceChildren(...names.map(name => new Option(name, name)));
      select.value = selected;
    };
    const syncSettings = () => {
      const themeSelect = settings.querySelector('#plain-theme');
      themeSelect.replaceChildren(...themes.getThemes().sort((a, b) => a.label.localeCompare(b.label)).map(theme => new Option(theme.label, theme.id)));
      themeSelect.value = themes.getCurrentTheme().id;
      settings.querySelector('#plain-sidebar-visible').checked = preferences.get(SIDEBAR_VISIBLE, true);
      syncFontOptions();
      settings.querySelector('#plain-font-size').value = preferences.get('editor.fontSize', 14);
      settings.querySelector('#plain-auto-save').value = preferences.get('files.autoSave', 'onWindowChange');
      settings.querySelector('#plain-auto-save-delay').value = preferences.get('files.autoSaveDelay', 1000);
      settings.querySelector('#plain-minimap').checked = preferences.get('editor.minimap.enabled', false);
      settings.querySelector('#plain-wrap').checked = preferences.get('editor.wordWrap', 'on') === 'on';
      settings.querySelector('#plain-delay-row').hidden = settings.querySelector('#plain-auto-save').value !== 'afterDelay';
    };
    const saveSetting = async input => {
      const key = input.dataset.preference;
      let value = input.value;
      if (input.type === 'checkbox') value = key === 'editor.wordWrap' ? (input.checked ? 'on' : 'off') : input.checked;
      if (input.type === 'number') {
        if (!input.reportValidity() || !Number.isFinite(input.valueAsNumber)) return;
        value = input.valueAsNumber;
      }
      if (key === 'editor.fontFamily') value = fontName(value);
      try {
        await preferences.set(key, value, PreferenceScope.User);
        if (key === 'editor.fontFamily') input.value = value;
        if (key === 'workbench.colorTheme') themes.setCurrentTheme(value, false);
        if (key === 'files.autoSave') settings.querySelector('#plain-delay-row').hidden = value !== 'afterDelay';
      } catch (error) {
        console.error(`Plain Editor: setting ${key}`, error);
        syncSettings();
      }
    };
    return {
      onDidInitializeLayout: async app => {
        shell = app.shell;
        await preferences.ready;
        syncFont();
        require('./editor-scroll')(editorManager);
        if (window.plainEditorDesktop) {
          window.plainEditorDesktop.onCloseRequested(async () => {
            let approved = false;
            try {
              approved = await windowService.isSafeToShutDown(StopReason.Close);
              if (approved) {
                layoutRestorer.storeLayout(app);
                await window.plainEditorDesktop.flushState();
              }
            } catch (error) {
              approved = false;
              console.error('Plain Editor could not review the close request', error);
              messages.error('Could not save the editor session. Please try closing again.');
            }
            window.plainEditorDesktop.closeReviewed(approved);
          });
          window.plainEditorDesktop.ready();
        }
        // The document tabs become the title bar; the action rail reserves space
        // through the shell's layout padding, keeping pane resizing accurate.
        shell.statusBar.hide();
        shell.topPanel.hide();
        for (const area of ['left', 'right', 'bottom']) shell.collapsePanel(area);
        // Hide the activity strip and remove collapsed panes from Lumino's layout.
        for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
          handler.container.layout.widgets.find(widget => widget.hasClass('theia-app-sidebar-container'))?.hide();
          const syncCollapsed = () => {
            if (handler.container.hasClass('theia-mod-collapsed') && !handler.container.isHidden) handler.container.hide();
          };
          new MutationObserver(syncCollapsed).observe(handler.container.node, { attributes: true, attributeFilter: ['class'] });
          syncCollapsed();
        }
        document.body.classList.add('plain-editor-ready');
        // Re-measure the native 35px tabs after the app applies its 40px title
        // row. Otherwise the editor overlaps the row and hides its separator.
        shell.mainPanel.fit();
        document.body.style.setProperty('--plain-window-space', window.plainEditorDesktop ? '104px' : '0px');
        header = buildHeader();
        titlebar = buildTitlebar();
        navigation = buildNavigation();
        menu = header.querySelector('#plain-menu');
        openMenu = buildOpenMenu();
        settings = buildSettings();
        chrome = createChromeLayout({ shell, preferences, header, titlebar, navigation,
          viewRegistry: container.get(PluginViewRegistry),
          plugins: container.get(HostedPluginSupport),
          contextKeys: container.get(ContextKeyService),
          getOpenPane: () => focusMode || !preferences.get(SIDEBAR_VISIBLE, true) ? '' : pinnedSide || previewSide,
          openView: id => { closeMenu(); return openSide(id); }, icon,
          openExtensionSettings: async id => {
            const deployed = plugins.plugins.map(metadata => plugins.getPlugin(metadata.model.id)).filter(Boolean);
            const owner = extensionViewOwner(id, deployed);
            if (!owner) { messages.info('This extension is no longer available.'); return; }
            const model = container.get(VSXExtensionsModel);
            await model.initialized;
            const extension = model.getExtension(owner.metadata.model.id) || {
              id: owner.metadata.model.id, displayName: owner.metadata.model.displayName,
              installed: true, plugin: owner
            };
            container.get(require('./extensions-panel').Catalog).openSettings(extension);
          }
        });
        window.addEventListener('plain-open-source-control', () => actions['source-control']().catch(error => messages.error(error.message)));
        window.addEventListener('plain-toggle-focus', toggleFocus);
        window.addEventListener('plain-toggle-pane', () => actions['toggle-pane']());
        window.addEventListener('plain-toggle-sidebar', () => actions['toggle-sidebar']());
        if (sessionStorage.getItem('plain-show-files-after-folder')) {
          sessionStorage.removeItem('plain-show-files-after-folder');
          setTimeout(() => openSide('files'), 150);
        }
        if (window.plainEditorDesktop) {
          const updateWindowState = state => {
            document.body.classList.toggle('plain-maximized', state.maximized);
            const maximize = titlebar.querySelector('[data-plain-action="maximize"]');
            maximize.title = state.maximized ? 'Restore window' : 'Maximize';
            maximize.setAttribute('aria-label', maximize.title);
          };
          window.plainEditorDesktop.onWindowStateChanged(updateWindowState);
          window.plainEditorDesktop.windowState().then(updateWindowState);
        }
        for (const area of ['left', 'right']) {
          const handler = shell[area === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'];
          const drag = document.createElement('div');
          drag.className = 'plain-pane-title-drag';
          drag.setAttribute('aria-hidden', 'true');
          handler.container.node.append(drag);
          const sideToolbar = handler.container.node.querySelector('.theia-sidepanel-toolbar');
          if (sideToolbar) {
          const openButton = document.createElement('button');
          openButton.type = 'button';
          openButton.className = 'plain-button plain-icon-only plain-files-open';
          openButton.dataset.plainAction = 'open';
          openButton.title = 'Open';
          openButton.setAttribute('aria-label', 'Open');
          openButton.setAttribute('aria-haspopup', 'menu');
          openButton.setAttribute('aria-expanded', 'false');
          openButton.innerHTML = icon('folder');
          openButton.hidden = true;
          sideToolbar.append(openButton);
          const closeSide = document.createElement('button');
          closeSide.type = 'button';
          closeSide.className = 'plain-side-close';
          closeSide.setAttribute('aria-label', 'Close side panel');
          closeSide.title = 'Close side panel';
          closeSide.textContent = '×';
          closeSide.addEventListener('click', () => {
            closeMenu();
            pinnedSide = '';
            closePreview();
            shell.collapsePanel(area);
          });
          sideToolbar.append(closeSide);
          }
          handler.container.node.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
          handler.container.node.addEventListener('pointerdown', () => {
            if (!previewSide) return;
            // Committing a choice in a hover pane must cancel its close timer
            // before the mouse moves to an editor or an extension webview.
            pinnedSide = previewSide;
            lastSide = pinnedSide;
            previewSide = '';
            clearTimeout(hoverTimer);
            document.body.classList.remove('plain-side-peek');
            chrome.syncTitlebar();
          }, true);
          handler.container.node.addEventListener('pointerleave', () => {
            if (previewSide) hoverTimer = setTimeout(closePreview, 250);
          });
        }
        for (const name of ['files', 'extensions']) {
          const control = header.querySelector(`[data-plain-action="${name}"]`);
          control.addEventListener('pointerenter', event => {
            if (event?.pointerType === 'touch') return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => openSide(name, true), 180);
          });
          control.addEventListener('pointerleave', () => {
            clearTimeout(hoverTimer);
            if (previewSide) hoverTimer = setTimeout(closePreview, 320);
          });
        }
        const handleControls = event => {
          const recent = event.target.closest('[data-recent-index]');
          if (recent) {
            closeMenu();
            openRecentFile(Number(recent.dataset.recentIndex));
            return;
          }
          const control = event.target.closest('[data-plain-action]');
          if (!control) return;
          const action = control.dataset.plainAction;
          if (!['menu', 'open', 'extension-views'].includes(action)) closeMenu();
          actions[action]?.(control);
        };
        header.addEventListener('click', handleControls);
        titlebar.addEventListener('click', handleControls);
        navigation.addEventListener('click', handleControls);
        window.addEventListener('plain-welcome-action', event => {
          closeMenu();
          if (event.detail.uri) openResource(openers, new URI(event.detail.uri)).catch(error => messages.error(`Could not open the file: ${error.message}`));
          else actions[event.detail.action]?.();
        });
        shell.onDidAddWidget(widget => {
          queueMicrotask(() => {
            if (widget.id !== welcome.ID && shell.getAreaFor(widget) === 'main') shell.getWidgetById(welcome.ID)?.dispose();
          });
        });
        openMenu.addEventListener('click', handleControls);
        for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
          handler.container.node.querySelector('.theia-sidepanel-toolbar')?.addEventListener('click', handleControls);
        }
        settings.addEventListener('click', event => {
          const action = event.target.closest('[data-settings-action]')?.dataset.settingsAction;
          if (action === 'close') settings.close();
          if (action === 'all') { settings.close(); execute('preferences:open'); }
          if (action === 'json') { settings.close(); actions['settings-json'](); }
        });
        settings.addEventListener('change', event => {
          if (event.target.matches('[data-preference]')) saveSetting(event.target);
        });
        document.addEventListener('pointerdown', event => {
          if (!header.contains(event.target) && !titlebar.contains(event.target) && !navigation.contains(event.target)
            && !openMenu.contains(event.target) && !event.target.closest('.plain-files-open')) closeMenu();
        });
        if (window.plainEditorDesktop) {
          const recordCurrentFile = editor => {
            const uri = editor?.getResourceUri?.() || editor?.resource;
            if (uri?.scheme !== 'file') return;
            window.plainEditorDesktop.recordRecentFile(uri.toString()).then(entries => {
              recentFiles = entries;
              if (!openMenu.hidden) renderRecentFiles();
            }).catch(error => console.error('Plain Editor: record recent file', error));
          };
          editorManager.onCurrentEditorChanged(recordCurrentFile);
          shell.onDidChangeCurrentWidget(() => recordCurrentFile(shell.currentWidget));
          recordCurrentFile(editorManager.currentEditor);
        }
        const closeMinimap = document.createElement('button');
        closeMinimap.id = 'plain-minimap-close';
        closeMinimap.type = 'button';
        closeMinimap.textContent = '×';
        closeMinimap.title = 'Hide code minimap';
        closeMinimap.setAttribute('aria-label', 'Hide code minimap');
        closeMinimap.hidden = true;
        closeMinimap.addEventListener('click', () => preferences.set('editor.minimap.enabled', false, PreferenceScope.User)
          .catch(error => console.error('Plain Editor: hide minimap', error)));
        const updateMinimap = () => {
          const editor = document.querySelector('#theia-main-content-panel .theia-editor:not(.lm-mod-hidden) .monaco-editor');
          const minimap = editor?.querySelector('.minimap');
          const visible = preferences.get('editor.minimap.enabled', false) && minimap && minimap.getClientRects().length > 0;
          if (visible && closeMinimap.parentElement !== editor) editor.append(closeMinimap);
          closeMinimap.hidden = !visible;
        };
        preferences.onPreferenceChanged(change => {
          if (change.preferenceName === 'editor.fontFamily') syncFont();
          if (change.preferenceName === 'editor.minimap.enabled') {
            updateMinimap();
            setTimeout(updateMinimap, 150);
          }
          if (settings.open) syncSettings();
        });
        themes.onDidColorThemeChange(() => { if (settings.open) syncSettings(); });
        shell.onDidChangeCurrentWidget(updateMinimap);
        // Retained extension webviews may deliver delayed focus reports after
        // their tab is hidden. Do not let those reports steal the current file.
        document.addEventListener('focus', event => {
          const view = event.target?.closest?.('.theia-webview');
          if (view && getComputedStyle(view).visibility === 'hidden') event.stopImmediatePropagation();
        }, true);
        shell.mainPanel.onDidChangeCurrent(title => {
          if (title) recordNavigation(title.owner);
        });
        shell.onDidChangeCurrentWidget(({ newValue }) => {
          if (newValue && shell.getAreaFor(newValue) === 'main') {
            recordNavigation(shell.getTabBarFor(newValue)?.currentTitle?.owner);
          }
        });
        shell.onDidRemoveWidget(widget => { history.remove(widget.id); syncNavigation(); });
        shell.onDidChangeCurrentWidget(() => {
          if (previewSide || focusMode) return;
          const current = shell.currentWidget;
          const area = current && shell.getAreaFor(current);
          if (area === 'left' || area === 'right') {
            const title = shell[area === 'right' ? 'rightPanelHandler' : 'leftPanelHandler'].tabBar.currentTitle;
            if (title) { pinnedSide = title.owner.id; lastSide = pinnedSide; }
          }
        });
        const main = document.getElementById('theia-main-content-panel');
        let minimapUpdateQueued = false;
        new MutationObserver(() => {
          if (minimapUpdateQueued) return;
          minimapUpdateQueued = true;
          requestAnimationFrame(() => { minimapUpdateQueued = false; updateMinimap(); });
        }).observe(main, { childList: true, subtree: true });
        updateMinimap();

        window.addEventListener('keydown', event => {
          if (event.key === 'Escape') closeMenu();
          if (settings.open || document.querySelector('#plain-extension-settings')?.open) return;
          if (!event.defaultPrevented && event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault(); event.stopImmediatePropagation();
            navigate(event.key === 'ArrowLeft' ? -1 : 1);
            return;
          }
          if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
          const key = event.key.toLowerCase();
          const action = event.shiftKey ? { s: 'save-as', t: 'reopen-closed', x: 'extensions', g: 'source-control' }[key] : ({
            s: 'save', n: 'new', o: 'open-file', w: 'close-tab', b: 'files', j: 'terminal', ',': 'settings', q: 'quit'
          })[key] || (event.code === 'Backquote' ? 'terminal' : undefined);
          if (!action || (action === 'quit' && !window.plainEditorDesktop)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          if (action === 'close-tab') execute('core.close.main.tab');
          else actions[action]?.();
        }, true);
        const restored = [...shell.mainPanel.widgets()];
        if (restored.some(widget => widget.id !== welcome.ID)) restored.find(widget => widget.id === welcome.ID)?.dispose();
        if (![...shell.mainPanel.widgets()].length) {
          const page = await widgets.getOrCreateWidget(welcome.ID);
          await shell.addWidget(page, { area: 'main' });
          await shell.activateWidget(page.id);
        }
        recordNavigation();
      }
    };
  }).inSingletonScope();
});
module.exports.default = module.exports;
