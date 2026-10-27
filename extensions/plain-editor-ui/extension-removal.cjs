'use strict';
const { PluginType } = require('@theia/plugin-ext');
class ExtensionRemoval {
  constructor({ verify, refresh, notify }) { Object.assign(this, { verify, refresh, notify }); this.pending = new Set(); }
  canRemove(extension) {
    return Boolean(extension?.installed && extension.builtin === false && extension.plugin?.type !== PluginType.System
      && !extension.uninstalled && !extension.currentTask && extension.installedVersion
      && typeof extension.uninstall === 'function' && !this.pending.has(extension.id));
  }
  async remove(extension) {
    if (!this.canRemove(extension)) throw Error('Only installed, non-built-in extensions can be removed.');
    this.pending.add(extension.id); this.notify();
    try {
      await extension.uninstall();
      if (!await this.verify(extension)) throw Error('The extension could not be removed. Try again or reload the window.');
      await this.refresh();
    } finally { this.pending.delete(extension.id); this.notify(); }
  }
}
module.exports = { ExtensionRemoval };
