'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), net = require('node:net'), path = require('node:path');
const { SshTerminalBridge } = require('../../extensions/plain-editor-ui/ssh-terminal-bridge.cjs');
const { SshConnections } = require('../../extensions/plain-editor-ui/ssh-connections.cjs');
const { parse } = require('../../extensions/plain-editor-ui/ssh-cli.cjs');
const StateStore = require('../../electron/state-store.cjs');
const { fixture } = require('./ssh-fixture.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('SSH command parsing supports users, ports, keys, IPv6 and system-SSH fallback', () => {
  assert.equal(parse(['tester@host']).username, 'tester');
  assert.equal(parse(['-p', '2200', '-i', '/key with spaces', 'tester@host']).keyPath, '/key with spaces');
  assert.equal(parse(['-p2200', 'tester@[::1]']).host, '::1');
  assert.equal(parse(['-l', 'tester', 'host']).username, 'tester');
  assert.equal(parse(['-L', '8080:localhost:80', 'host']), undefined);
  assert.equal(parse(['host', 'remote command']), undefined);
  assert.throws(() => parse(['-i']), /Missing/);
});
test('normal terminal bridge verifies a host, authenticates and shares its SSH connection with remote files', { timeout: 10000 }, async t => {
  const device = await fixture(), connections = new SshConnections(new StateStore(path.join(device.directory, 'profiles.json')));
  let opened, text = '', ready = false, socket;
  const bridge = new SshTerminalBridge(connections, { remoteConnected: async value => { opened = value; } });
  t.after(async () => { socket?.destroy(); await bridge.dispose(); connections.dispose(); await device.close(); });
  const details = await bridge.ready; socket = net.connect(details.port, '127.0.0.1'); socket.setEncoding('utf8');
  let buffer = ''; const send = value => socket.write(JSON.stringify(value) + '\n');
  socket.on('data', data => { buffer += data; while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (frame.type === 'prompt') send({ type: 'answer', id: frame.id, value: frame.secret ? 'test-password' : 'yes' });
    if (frame.type === 'ready') ready = true;
    if (frame.type === 'output') text += Buffer.from(frame.data, 'base64').toString();
    if (frame.type === 'error') assert.fail(frame.message);
  } });
  await new Promise(resolve => socket.once('connect', resolve));
  send({ type: 'start', token: details.token, input: { host: '127.0.0.1', port: device.port, username: 'tester', keyPaths: [] } });
  const end = Date.now() + 8000; while ((!opened || !ready || !text.includes('TEST SSH READY')) && Date.now() < end) await pause(20);
  assert(opened); assert(ready); assert.equal(opened.folder, '/home/tester'); assert(connections.sessions.has(opened.id));
  send({ type: 'input', data: Buffer.from('echo REMOTE_COMMAND\r').toString('base64') });
  while (!text.includes('REMOTE_COMMAND') && Date.now() < end) await pause(20);
  assert(text.includes('REMOTE_COMMAND')); assert(device.shellInput.join('').includes('REMOTE_COMMAND'));
});
test('SSH terminal bridge rejects unauthenticated local clients and cleans up an early shutdown', { timeout: 5000 }, async () => {
  const connections = new SshConnections({ get: async () => [] });
  const bridge = new SshTerminalBridge(connections, {}), details = await bridge.ready;
  const socket = net.connect(details.port, '127.0.0.1');
  await new Promise(resolve => socket.once('connect', resolve));
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.write(JSON.stringify({ type: 'start', token: 'invalid' }) + '\n'); await closed;
  assert.equal(connections.sessions.size, 0); await bridge.dispose(); connections.dispose();
  const early = new SshTerminalBridge(new SshConnections({ get: async () => [] }), {}); await early.dispose();
  assert.equal(early.server.listening, false);
});
test('workspace conversion preserves remote schemes, folder order and local conversion', () => {
  const { preserveSshFolders } = require('../../extensions/plain-editor-ui/ssh-workspace.cjs');
  const converted = [], settings = { example: true }, data = { folders: [{ path: '/local' }, { path: 'ssh://connection/home/user', name: 'Remote' }, { path: '../other' }], settings };
  const result = preserveSshFolders((value, workspace) => { converted.push(value.folders[0].path); assert.equal(workspace, 'workspace'); return { folders: [{ path: 'converted:' + value.folders[0].path }] }; })(data, 'workspace');
  assert.deepEqual(converted, ['/local', '../other']); assert.equal(result.folders[1].path, 'ssh://connection/home/user'); assert.equal(result.folders[1].name, 'Remote'); assert.equal(result.settings, settings); assert.equal(data.folders[0].path, '/local');
});
test('Bash and Zsh retain the IDE SSH command when login scripts reorder PATH', async t => {
  if (process.platform === 'win32') { t.skip('POSIX login shells'); return; }
  const fs = require('node:fs/promises'), { spawnSync } = require('node:child_process');
  const { terminalEnvironment } = require('../../extensions/plain-editor-ui/ssh-shell.cjs');
  const connections = new SshConnections({ get: async () => [] }), bridge = new SshTerminalBridge(connections, {});
  t.after(async () => { await bridge.dispose(); connections.dispose(); });
  const details = { ...await bridge.ready, originalPath: process.env.PATH, delimiter: path.delimiter, platform: process.platform, zdotdir: '' };
  await fs.writeFile(path.join(details.directory, 'ssh'), '#!/bin/sh\nprintf "INTEGRATED_SSH:%s:%s" "$1" "$SINGULARITY_TEST_USER_RC"\n', { mode: 0o700 });
  const original = path.join(details.directory, 'original'); await fs.mkdir(original);
  await fs.writeFile(path.join(original, '.zshenv'), 'export SINGULARITY_TEST_USER_RC=loaded\n');
  const env = terminalEnvironment({ ZDOTDIR: original }, details, '/bin/zsh');
  const bash = spawnSync('/bin/bash', ['--noprofile', '--norc', '-lc', 'PATH=/usr/bin:/bin; ssh "host with spaces"'], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(bash.status, 0, bash.stderr); assert.match(bash.stdout, /INTEGRATED_SSH:host with spaces:/);
  const zsh = spawnSync('/bin/zsh', ['-lc', 'PATH=/usr/bin:/bin; ssh "host with spaces"; test "$ZDOTDIR" = "$SINGULARITY_SSH_ORIGINAL_ZDOTDIR"'], { env: { ...process.env, ...env }, encoding: 'utf8' });
  if (zsh.error?.code !== 'ENOENT') { assert.equal(zsh.status, 0, zsh.stderr); assert.match(zsh.stdout, /INTEGRATED_SSH:host with spaces:loaded/); }
});
