'use strict';

// A desktop backend belongs to one Electron process. A suspended renderer must
// reconnect to its existing RPC/plugin services instead of creating new ones.
function retainDesktopConnections(service) {
  const original = service.createConnection;
  service.createConnection = function (socket, id) {
    // Reload/crash creates a new frontend ID. Release abandoned sessions here,
    // so keeping a sleeping session does not accumulate old plugin hosts.
    for (const [previous, channel] of this.connectionsByFrontend) {
      if (previous !== id && !channel.socket?.connected) this.closeConnection(previous, 'renderer replaced');
    }
    return original.call(this, socket, id);
  };
}
module.exports = { retainDesktopConnections };
