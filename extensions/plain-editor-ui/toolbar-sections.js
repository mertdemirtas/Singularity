'use strict';
const React = require('@theia/core/shared/react');
const { decorate, injectable } = require('@theia/core/shared/inversify');
const { TabBarToolbar, TabBarToolbarFactory } = require('@theia/core/lib/browser/shell/tab-bar-toolbar');
const { ActionMenuNode } = require('@theia/core/lib/common/menu');
const { Emitter } = require('@theia/core/lib/common/event');
const { FrontendApplicationContribution } = require('@theia/core/lib/browser/frontend-application-contribution');
const { HostedPluginSupport } = require('@theia/plugin-ext/lib/hosted/browser/hosted-plugin');
const { commandOwners, toolbarOwner, sections, fitToolbar } = require('./toolbar-sections.cjs');
module.exports = (bind, rebind) => {
  let owners = new Map();
  const changed = new Emitter();
  class SectionedToolbar extends TabBarToolbar {
    init() {
      super.init(); this.widths = new Map(); this.hiddenItems = new Set();
      this.toDispose.push(changed.event(() => this.update()));
      this.observer = new ResizeObserver(() => this.queueMeasure());
      this.toDispose.push({ dispose: () => { this.observer.disconnect(); cancelAnimationFrame(this.measureFrame); } });
    }
    onAfterAttach(message) {
      super.onAfterAttach(message);
      this.observer.observe(this.node);
      const row = this.node.closest('.theia-tabBar-tab-row'); if (row) this.observer.observe(row);
      this.queueMeasure();
    }
    onBeforeDetach(message) { this.observer.disconnect(); super.onBeforeDetach(message); }
    queueMeasure() {
      if (this.measureFrame || !this.isAttached || this.isDisposed) return;
      this.measureFrame = requestAnimationFrame(() => { this.measureFrame = undefined; this.measure(); });
    }
    overflowItem(item) {
      const command = this.commands.getCommand(item.id);
      if (!item.toMenuNode && !command) return undefined;
      return { id: item.id, group: toolbarOwner(item, owners), toMenuNode: () => item.toMenuNode ? item.toMenuNode()
        : new ActionMenuNode({ commandId: item.id, label: command.label }, this.commands, this.keybindings, this.contextKeyService) };
    }
    measure() {
      const row = this.node.closest('.theia-tabBar-tab-row'); if (!row) return;
      for (const element of this.node.querySelectorAll('[data-toolbar-item]')) {
        const style = getComputedStyle(element);
        this.widths.set(element.dataset.toolbarItem, element.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight));
      }
      const rect = row.getBoundingClientRect(), style = getComputedStyle(row), toolbarStyle = getComputedStyle(this.node);
      const windows = row.querySelector('#plain-titlebar')?.getBoundingClientRect().width || 0;
      const padding = parseFloat(toolbarStyle.paddingLeft) + parseFloat(toolbarStyle.paddingRight);
      const budget = Math.max(48, rect.width - windows - parseFloat(style.paddingLeft) - Math.min(120, rect.width / 4) - padding);
      const entries = [...this.inline.values()].map(item => ({ id: item.id, owner: toolbarOwner(item, owners), width: this.widths.get(item.id) || 24, canOverflow: Boolean(this.overflowItem(item)) }));
      const hidden = fitToolbar(entries, budget, this.more.size > 0);
      if (hidden.size !== this.hiddenItems.size || [...hidden].some(id => !this.hiddenItems.has(id))) { this.hiddenItems = hidden; this.update(); }
    }
    renderMoreContextMenu(anchor) {
      const original = this.more; this.more = this.overflowMore || original;
      try { return super.renderMoreContextMenu(anchor); } finally { this.more = original; }
    }
    render() {
      this.keybindingContextKeys.clear();
      const originalMore = this.more; this.overflowMore = new Map(originalMore);
      for (const item of this.inline.values()) if (this.hiddenItems.has(item.id)) {
        const menuItem = this.overflowItem(item); if (menuItem) this.overflowMore.set(item.id, menuItem);
      }
      this.more = this.overflowMore;
      const more = this.renderMore(); this.more = originalMore;
      const entries = [{ id: '__more__', owner: 'editor', node: more }];
      for (const item of this.inline.values()) if (!this.hiddenItems.has(item.id)) entries.push({ id: item.id, owner: toolbarOwner(item, owners), node: item.render(this.current, this.contextMatcher) });
      const nodes = [];
      for (const [owner, items] of sections(entries)) {
        if (nodes.length) nodes.push(React.createElement('span', { key: 'separator:' + owner, className: 'plain-toolbar-separator', role: 'separator', 'aria-orientation': 'vertical' }));
        for (const item of items) nodes.push(React.isValidElement(item.node) && typeof item.node.type === 'string'
          ? React.cloneElement(item.node, { 'data-toolbar-owner': owner, 'data-toolbar-item': item.id, key: item.id })
          : React.createElement(React.Fragment, { key: item.id }, item.node));
      }
      this.queueMeasure();
      return React.createElement(React.Fragment, null, ...nodes);
    }
  }
  decorate(injectable(), SectionedToolbar);
  rebind(TabBarToolbarFactory).toFactory(({ container }) => () => {
    const child = container.createChild();
    child.bind(TabBarToolbar).to(SectionedToolbar).inSingletonScope();
    return child.get(TabBarToolbar);
  });
  let subscription;
  bind(FrontendApplicationContribution).toDynamicValue(({ container }) => ({
    onStart() {
      // Resolve plugins after shell construction to avoid a startup dependency cycle.
      const plugins = container.get(HostedPluginSupport);
      const refresh = () => {
        owners = commandOwners(plugins.plugins.map(metadata => plugins.getPlugin(metadata.model.id)).filter(Boolean));
        changed.fire();
      };
      subscription = plugins.onDidChangePlugins(refresh); refresh();
    },
    onStop() { subscription?.dispose(); changed.dispose(); }
  }));
};
