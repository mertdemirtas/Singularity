'use strict';
const React = require('@theia/core/shared/react');
const { decorate, injectable, inject } = require('@theia/core/shared/inversify');
const { WidgetFactory } = require('@theia/core/lib/browser/widget-manager');
const { FileNavigatorModel } = require('@theia/navigator/lib/browser/navigator-model');
const { FileNavigatorWidget } = require('@theia/navigator/lib/browser/navigator-widget');
const { createFileNavigatorContainer } = require('@theia/navigator/lib/browser/navigator-container');
const { scopedRoot } = require('./ssh-navigator.cjs');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { REMOTE_VIEW, SSH_CONTROLLER } = require('./ssh-protocol');
class RemoteNavigatorModel extends FileNavigatorModel {
  get remoteScope() { return true; }
}
class RemoteNavigatorWidget extends FileNavigatorWidget {
  init() {
    super.init(); this.id = REMOTE_VIEW;
    this.title.label = 'Remote'; this.title.caption = 'Remote devices';
    this.title.iconClass = 'codicon codicon-remote'; this.title.closable = true;
    this.title.dataset = { ...this.title.dataset, visibilityCommandLabel: 'Remote' };
    this.toDispose.push(this.controller.changes.event(() => this.update()));
  }
  updateTitle() { this.title.label = 'Remote'; this.title.caption = 'Remote devices'; }
  shouldShowWelcomeView() { return false; }
  renderTree(model) {
    const h = React.createElement;
    const profiles = this.controller.profiles;
    const connections = profiles.length ? h('section', { className: 'plain-remote-connections', 'aria-label': 'Saved SSH connections' },
      h('h3', null, 'Connections'),
      ...profiles.map(value => h('button', { key: value.id, type: 'button', className: 'plain-remote-connect', 'data-ssh-connect': value.id,
        title: value.connected ? 'Open remote folder' : 'Connect in an SSH terminal',
        onClick: () => this.controller.reconnect(value).catch(error => this.remoteMessages.error(error.message)) },
      h('span', { className: 'codicon codicon-remote', 'aria-hidden': true }),
      h('span', { className: 'plain-remote-host' }, value.name || `${value.username}@${value.host}`, h('small', null, `${value.username}@${value.host}:${value.port}`)),
      h('span', { className: 'plain-remote-status' }, value.connected ? 'Connected' : 'Connect')))) : null;
    const tree = model.root?.children.length ? super.renderTree(model) : h('p', { className: 'plain-remote-help' }, 'Connect with ssh user@host in the terminal to browse a device.');
    return h(React.Fragment, null, connections, tree);
  }
}
decorate(injectable(), RemoteNavigatorModel);
decorate(injectable(), RemoteNavigatorWidget);
decorate(inject(SSH_CONTROLLER), RemoteNavigatorWidget.prototype, 'controller');
decorate(inject(MessageService), RemoteNavigatorWidget.prototype, 'remoteMessages');
module.exports = bind => {
  const createRoot = FileNavigatorModel.prototype.createRoot;
  FileNavigatorModel.prototype.createRoot = async function () { return scopedRoot(await createRoot.call(this), Boolean(this.remoteScope)); };
  bind(WidgetFactory).toDynamicValue(({ container }) => ({
    id: REMOTE_VIEW,
    async createWidget() {
      await container.get(SSH_CONTROLLER).refresh();
      const child = createFileNavigatorContainer(container);
      child.rebind(FileNavigatorModel).to(RemoteNavigatorModel).inSingletonScope();
      child.rebind(FileNavigatorWidget).to(RemoteNavigatorWidget).inSingletonScope();
      const widget = child.get(FileNavigatorWidget);
      await widget.model.workspaceService.roots; await widget.model.updateRoot();
      return widget;
    }
  }));
};
