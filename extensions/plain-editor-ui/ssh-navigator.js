'use strict';
const React = require('@theia/core/shared/react');
const { decorate, injectable } = require('@theia/core/shared/inversify');
const { WidgetFactory } = require('@theia/core/lib/browser/widget-manager');
const { FileNavigatorModel } = require('@theia/navigator/lib/browser/navigator-model');
const { FileNavigatorWidget } = require('@theia/navigator/lib/browser/navigator-widget');
const { createFileNavigatorContainer } = require('@theia/navigator/lib/browser/navigator-container');
const { scopedRoot } = require('./ssh-navigator.cjs');
const { REMOTE_VIEW } = require('./ssh-protocol');
class RemoteNavigatorModel extends FileNavigatorModel {
  get remoteScope() { return true; }
}
class RemoteNavigatorWidget extends FileNavigatorWidget {
  init() {
    super.init(); this.id = REMOTE_VIEW;
    this.title.label = 'Remote'; this.title.caption = 'Remote devices';
    this.title.iconClass = 'codicon codicon-remote'; this.title.closable = true;
    this.title.dataset = { ...this.title.dataset, visibilityCommandLabel: 'Remote' };
  }
  updateTitle() { this.title.label = 'Remote'; this.title.caption = 'Remote devices'; }
  shouldShowWelcomeView() { return false; }
  renderTree(model) {
    if (!model.root?.children.length) return React.createElement('div', { className: 'theia-navigator-container' },
      React.createElement('p', { className: 'center' }, 'Connect with ssh user@host in the terminal to browse a device.'));
    return super.renderTree(model);
  }
}
decorate(injectable(), RemoteNavigatorModel);
decorate(injectable(), RemoteNavigatorWidget);
module.exports = bind => {
  const createRoot = FileNavigatorModel.prototype.createRoot;
  FileNavigatorModel.prototype.createRoot = async function () { return scopedRoot(await createRoot.call(this), Boolean(this.remoteScope)); };
  bind(WidgetFactory).toDynamicValue(({ container }) => ({
    id: REMOTE_VIEW,
    async createWidget() {
      const child = createFileNavigatorContainer(container);
      child.rebind(FileNavigatorModel).to(RemoteNavigatorModel).inSingletonScope();
      child.rebind(FileNavigatorWidget).to(RemoteNavigatorWidget).inSingletonScope();
      const widget = child.get(FileNavigatorWidget);
      await widget.model.workspaceService.roots; await widget.model.updateRoot();
      return widget;
    }
  }));
};
