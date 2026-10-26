'use strict';
const path = require('node:path');
const { ConnectionHandler, RpcConnectionHandler } = require('@theia/core/lib/common/messaging');
const { EnvVariablesServer } = require('@theia/core/lib/common/env-variables');
const { FileUri } = require('@theia/core/lib/common/file-uri');
const { FileSystemProviderServer, RemoteFileSystemProxyFactory } = require('@theia/filesystem/lib/common/remote-file-system-provider');
const StateStore = require('../../electron/state-store.cjs');
const { SshConnections } = require('./ssh-connections.cjs');
const { SshFiles } = require('./ssh-files.cjs');
const { SSH_PATH } = require('./ssh-protocol');
class SshServer extends FileSystemProviderServer {
  constructor(store, client) {
    super(); this.setClient(client); this.connections = new SshConnections(store, client); this.provider = new SshFiles(this.connections); this.init();
  }
  listConnections() { return this.connections.list(); }
  disconnect(id) { this.connections.disconnect(id); }
  forget(id) { return this.connections.forget(id); }
  // Theia's server allocates a 64 KB read buffer. Clamp client requests to it.
  read(fd, position, length) { return super.read(fd, position, Math.min(length, 65536)); }
  async terminalEnvironment() {
    this.bridge ||= new (require('./ssh-terminal-bridge.cjs').SshTerminalBridge)(this.connections, this.client);
    const details = await this.bridge.ready; return { ...details, delimiter: path.delimiter, originalPath: process.env.PATH || '', shell: process.env.THEIA_SHELL || process.env.SHELL || '', zdotdir: process.env.ZDOTDIR || '', platform: process.platform };
  }
  dispose() { this.bridge?.dispose().catch(error => console.error('SSH terminal cleanup:', error.message)); super.dispose(); }

}
module.exports = bind => {
  let store;
  bind(ConnectionHandler).toDynamicValue(({ container }) => new RpcConnectionHandler(SSH_PATH, client => {
    if (!store) {
      const ready = container.get(EnvVariablesServer).getConfigDirUri().then(uri => new StateStore(path.join(FileUri.fsPath(uri), 'ssh-connections.json')));
      let pending = Promise.resolve();
      store = { get: async key => (await ready).get(key), mutate(operation) { const update = pending.catch(() => {}).then(async () => operation(await ready)); pending = update; return update; } };
    }
    const server = new SshServer(store, client);
    client.onDidCloseConnection(() => server.dispose());
    return server;
  }, RemoteFileSystemProxyFactory)).inSingletonScope();
};
module.exports.SshServer = SshServer;
