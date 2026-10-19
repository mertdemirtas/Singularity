'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { watchParent } = require('../../electron/backend-process.cjs');
const { retainDesktopConnections } = require('../../extensions/plain-editor-ui/desktop-connections.cjs');
const { waitForBackend } = require('../../electron/backend-start.cjs');
const { WebsocketFrontendConnectionService } = require('@theia/core/lib/node/messaging/websocket-frontend-connection-service');

function sockets() {
  const service = new WebsocketFrontendConnectionService();
  service.logger = { info() {} };
  service.frontendConnectionTimeout = () => -1;
  service.createConnection = () => {};
  const old = new EventEmitter(), current = new EventEmitter(), closed = [];
  const channel = { socket: old, disconnect() { this.socket = undefined; } };
  service.closeConnection = id => closed.push(id);
  retainDesktopConnections(service);
  return { service, old, current, channel, closed };
}
test('a late disconnect from the pre-sleep socket cannot detach its replacement transport', () => {
  const { service, old, current, channel } = sockets();
  service.handleSocketDisconnect(old, channel, 'editor');
  channel.socket = current;
  service.handleSocketDisconnect(current, channel, 'editor');
  old.emit('disconnect', 'old heartbeat expired');
  assert.equal(channel.socket, current);
  current.emit('disconnect', 'sleep again');
  assert.equal(channel.socket, undefined);
});
test('sleep retains a desktop session while an explicitly closed renderer can release it', () => {
  const { service, old, current, channel, closed } = sockets();
  service.handleSocketDisconnect(old, channel, 'editor'); old.emit('disconnect');
  assert.deepEqual(closed, []);
  channel.socket = current; service.channelsMarkedForClose.add('editor');
  service.handleSocketDisconnect(current, channel, 'editor'); current.emit('disconnect');
  assert.deepEqual(closed, ['editor']);
  assert.equal(current.listenerCount('disconnect'), 0);
});

test('new renderers release disconnected sessions but preserve live secondary frontends', () => {
  const closed = [];
  const service = {
    connectionsByFrontend: new Map([['sleeping', {}], ['live', { socket: { connected: true } }]]),
    closeConnection(id) { closed.push(id); this.connectionsByFrontend.delete(id); },
    createConnection(socket, id) { const channel = { socket }; this.connectionsByFrontend.set(id, channel); return channel; }
  };
  retainDesktopConnections(service);
  for (let i = 0; i < 100; i++) {
    service.createConnection({ connected: true }, 'replacement' + i);
    service.connectionsByFrontend.get('replacement' + i).socket.connected = false;
    assert(service.connectionsByFrontend.size <= 2);
  }
  assert(closed.includes('sleeping')); assert(!closed.includes('live'));
});
test('reconnecting the same sleeping frontend retains its existing state', () => {
  const service = { connectionsByFrontend: new Map([['same', {}]]), closeConnection() { assert.fail('live session was discarded'); }, createConnection() { return 'created'; } };
  retainDesktopConnections(service); assert.equal(service.createConnection({}, 'same'), 'created');
});
test('desktop-parent disconnect signals only the dedicated backend process group and removes its listener', () => {
  const host = new EventEmitter(), signals = [];
  Object.assign(host, { pid: 123456, platform: 'linux', kill: (...args) => signals.push(args), exit: () => assert.fail('unexpected exit') });
  const dispose = watchParent({ host, delay: 10000 });
  host.emit('disconnect'); host.emit('disconnect');
  assert.deepEqual(signals, [[-123456, 'SIGTERM']]);
  dispose(); assert.equal(host.listenerCount('disconnect'), 0);
});
test('backend readiness failures release all listeners and reject instead of leaving startup pending', async () => {
  for (const failure of ['error', 'exit', 'timeout']) {
    const child = new EventEmitter(), ready = waitForBackend(child, 12345, 5);
    if (failure !== 'timeout') child.emit(failure, failure === 'error' ? new Error('startup failed') : 1);
    await assert.rejects(ready);
    for (const event of ['message', 'error', 'exit']) assert.equal(child.listenerCount(event), 0);
  }
});
