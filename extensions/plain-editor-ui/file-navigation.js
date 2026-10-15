'use strict';

const { decorate, injectable } = require('@theia/core/shared/inversify');
const { FileNavigatorWidget } = require('@theia/navigator/lib/browser/navigator-widget');
const { FileNavigatorModel } = require('@theia/navigator/lib/browser/navigator-model');
const { createFileNavigatorContainer } = require('@theia/navigator/lib/browser/navigator-container');
const { FileNode } = require('@theia/filesystem/lib/browser/file-tree/file-tree');
const { open } = require('@theia/core/lib/browser/opener-service');

class PlainFileNavigatorModel extends FileNavigatorModel {
  previewNode(node) {
    if (!FileNode.is(node)) return;
    // Reveal alone can leave an extension webview as the current editor.
    // A deliberate file click should also focus the chosen registered opener.
    return open(this.openerService, node.uri, { mode: 'activate', preview: true })
      .catch(error => this.messageService.error(`Could not open ${node.name || node.uri.path.base}: ${error.message}`));
  }
}
decorate(injectable(), PlainFileNavigatorModel);

module.exports = function installFileNavigation(container) {
  // Resolve this contribution after all native frontend modules are loaded.
  container.rebind(FileNavigatorWidget).toDynamicValue(({ container: parent }) => {
    const child = createFileNavigatorContainer(parent);
    child.rebind(FileNavigatorModel).to(PlainFileNavigatorModel).inSingletonScope();
    return child.get(FileNavigatorWidget);
  });
};
