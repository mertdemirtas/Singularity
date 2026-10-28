'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const URI = require('@theia/core/lib/common/uri').default;
const StateStore = require('../../electron/state-store.cjs');
const { SshConnections, profile } = require('../../extensions/plain-editor-ui/ssh-connections.cjs');
const { SshFiles } = require('../../extensions/plain-editor-ui/ssh-files.cjs');
const { fixture } = require('./ssh-fixture.cjs');
async function setup(t, client = {}) {
  const device = await fixture(), store = new StateStore(path.join(device.directory, 'profiles.json'));
  const connections = new SshConnections(store, { confirmHost: async () => true, ...client });
  const files = new SshFiles(connections);
  t.after(async () => { files.dispose(); await device.close(); });
  const input = profile({ host: '127.0.0.1', port: device.port, username: 'tester', auth: 'password', folder: '~/project' });
  const uri = name => new URI(`ssh://${input.id}/home/tester/project/${name}`);
  return { device, store, connections, files, input, uri };
}
test('SSH/SFTP browses and edits the real remote filesystem without persisting credentials', { timeout: 20000 }, async t => {
  let confirmed = 0; const { device, store, connections, files, input, uri } = await setup(t, { confirmHost: async details => { assert.match(details.fingerprint, /^SHA256:/); confirmed++; return true; } });
  const saved = await connections.connect(input, { password: 'test-password' });
  assert.equal(saved.folder, '/home/tester/project'); assert.equal(confirmed, 1);
  assert((await files.readdir(uri(''))).some(([name]) => name === 'remote.txt'));
  assert.match(Buffer.from(await files.readFile(uri('remote.txt'))).toString(), /remote device/);
  await files.writeFile(uri('remote.txt'), Buffer.from('saved remotely 🪐\n'), { create: true, overwrite: true });
  assert.equal(await fs.readFile(path.join(device.directory, 'project', 'remote.txt'), 'utf8'), 'saved remotely 🪐\n');
  await files.mkdir(uri('new folder')); await files.writeFile(uri('new folder/new.txt'), Buffer.from('new'), { create: true, overwrite: false });
  await files.rename(uri('new folder/new.txt'), uri('new folder/renamed.txt'), { overwrite: false });
  await assert.rejects(files.writeFile(uri('new folder/renamed.txt'), Buffer.from('overwrite'), { create: true, overwrite: false }));
  await files.delete(uri('new folder'), { recursive: true });
  const disk = await fs.readFile(store.filename, 'utf8'); assert(!disk.includes('test-password')); assert(!disk.includes('passphrase')); assert(disk.includes('SHA256:'));
  connections.disconnect(input.id); await assert.rejects(files.stat(uri('remote.txt')), /disconnected/);
  await connections.connect(saved, { password: 'test-password' }); assert.equal(confirmed, 1);
});
test('remote save failures preserve the original file and remove temporary uploads', { timeout: 20000 }, async t => {
  const { device, connections, files, input, uri } = await setup(t); await connections.connect(input, { password: 'test-password' });
  const original = await fs.readFile(path.join(device.directory, 'project', 'remote.txt'), 'utf8');
  for (const flag of ['failWrite', 'failRename']) {
    device.state[flag] = true;
    await assert.rejects(files.writeFile(uri('remote.txt'), Buffer.from('must not replace original'), { create: true, overwrite: true }));
    assert.equal(await fs.readFile(path.join(device.directory, 'project', 'remote.txt'), 'utf8'), original);
    assert.deepEqual(await fs.readdir(path.join(device.directory, 'project')), ['remote.txt']);
    device.state[flag] = false;
  }
});
test('large remote files transfer in bounded chunks and release all file handles', { timeout: 30000 }, async t => {
  const { device, connections, files, input, uri } = await setup(t); await connections.connect(input, { password: 'test-password' });
  const data = Buffer.alloc(12 * 1024 * 1024 + 17, 65);
  await files.writeFile(uri('large.csv'), data, { create: true, overwrite: true });
  assert(device.writes.every(size => size <= 65536)); assert.deepEqual(await files.readFile(uri('large.csv')), data); assert.equal(files.handles.size, 0);
});
test('SSH rejects changed host keys before authentication and supports forgetting trusted profiles', { timeout: 20000 }, async t => {
  let prompts = 0; const { store, connections, input } = await setup(t, { confirmHost: async () => { prompts++; return true; } });
  await connections.connect(input, { password: 'test-password' }); connections.disconnect(input.id);
  await store.set('hosts', { ['127.0.0.1:' + input.port]: 'SHA256:changed' });
  await assert.rejects(connections.connect(input, { password: 'test-password' }), /host key has changed/); assert.equal(prompts, 1);
  await connections.forget(input.id); assert.deepEqual(await store.get('profiles'), []); assert.deepEqual(await store.get('hosts'), {});
});
test('SSH cancellation and authentication failures leave no live sessions or saved secrets', { timeout: 20000 }, async t => {
  const { store, connections, input } = await setup(t, { confirmHost: async () => false });
  await assert.rejects(connections.connect(input, { password: 'test-password' }), /cancelled/);
  connections.client.confirmHost = async () => true;
  await assert.rejects(connections.connect(input, { password: 'incorrect' }), /authentication/i);
  assert.equal(connections.sessions.size, 0); assert.equal(connections.connecting.size, 0); assert.equal(await store.get('profiles'), undefined);
});
test('private-key authentication can reopen a saved profile without saving key material', { timeout: 20000 }, async t => {
  const { device, store, connections, input } = await setup(t);
  const keyPath = path.join(device.directory, 'test-key'); await fs.writeFile(keyPath, device.hostKey, { mode: 0o600 });
  const keyProfile = { ...input, auth: 'key', keyPath };
  await connections.connect(keyProfile); connections.disconnect(input.id); await connections.connect(keyProfile);
  assert(!JSON.stringify(await store.get('profiles')).includes('PRIVATE KEY'));
});
test('simultaneous SSH connections preserve both saved profiles', { timeout: 20000 }, async t => {
  const { connections, store, input } = await setup(t);
  const other = { ...input, id: require('node:crypto').randomUUID(), name: 'Second connection' };
  await Promise.all([connections.connect(input, { password: 'test-password' }), connections.connect(other, { password: 'test-password' })]);
  assert.equal((await store.get('profiles')).length, 2); assert.equal(connections.sessions.size, 2);
});
test('disposing SSH while a device is silent aborts the pending handshake immediately', { timeout: 5000 }, async t => {
  const net = require('node:net'), sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const connections = new SshConnections({ get: async () => undefined }, {}, { timeout: 20000 });
  t.after(async () => { connections.dispose(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const pending = connections.connect(profile({ host: '127.0.0.1', port: server.address().port, username: 'tester', auth: 'password' }), { password: 'never logged' });
  const rejected = assert.rejects(pending);
  while (!connections.pendingClients.size) await new Promise(setImmediate);
  connections.dispose(); await rejected; assert.equal(connections.sessions.size, 0); assert.equal(connections.pendingClients.size, 0);
});
test('SSH follows remote symlinks without replacing the link when saving', { timeout: 10000 }, async t => {
  const { device, connections, files, input, uri } = await setup(t);
  try { await fs.symlink(path.join(device.directory, 'project', 'remote.txt'), path.join(device.directory, 'project', 'link.txt')); await fs.symlink(path.join(device.directory, 'project'), path.join(device.directory, 'project-link'), 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symlinks are unavailable on this test host.'); return; } throw error; }
  await connections.connect(input, { password: 'test-password' });
  await files.writeFile(uri('link.txt'), Buffer.from('saved through a link'), { create: true, overwrite: true });
  assert((await fs.lstat(path.join(device.directory, 'project', 'link.txt'))).isSymbolicLink());
  assert.equal(await fs.readFile(path.join(device.directory, 'project', 'remote.txt'), 'utf8'), 'saved through a link');
  const home = new URI(`ssh://${input.id}/home/tester`);
  assert((await files.readdir(home)).some(([name, type]) => name === 'project-link' && (type & 2) && (type & 64)));
});
test('offline SSH roots remain available without reconnecting or reading remote documents', { timeout: 10000 }, async t => {
  const { connections, files, input, uri } = await setup(t);
  await connections.connect(input, { password: 'test-password' }); connections.disconnect(input.id);
  assert.equal((await files.stat(uri(''))).type, 2);
  assert.deepEqual(await files.readdir(uri('')), []);
  await assert.rejects(files.readFile(uri('remote.txt')), /disconnected/);
  assert.equal(connections.sessions.size, 0); assert.equal(connections.pendingClients.size, 0);
});
test('remote watching detects external edits and a save cannot overwrite a concurrently changed file', { timeout: 10000 }, async t => {
  const { device, connections, files, input, uri } = await setup(t);
  await connections.connect(input, { password: 'test-password' });
  const events = [], listener = files.onDidChangeFile(changes => events.push(...changes));
  const watcher = files.watch(uri('remote.txt')); await files.poll();
  const fd = await files.open(uri('remote.txt'), { create: true });
  await files.write(fd, 0, Buffer.from('our change'), 0, 10);
  const filename = path.join(device.directory, 'project', 'remote.txt');
  await fs.writeFile(filename, 'external update must survive'); await files.poll();
  assert(events.some(event => event.resource.toString() === uri('remote.txt').toString()));
  await assert.rejects(files.close(fd), /changed while saving/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'external update must survive');
  assert.deepEqual(await fs.readdir(path.dirname(filename)), ['remote.txt']);
  assert.equal(files.handles.size, 0); watcher.dispose(); listener.dispose(); assert.equal(files.timer, undefined);
});

test('unsaved SSH documents persist as recovery copies without contacting the remote server', async t => {
  const os = require('node:os'), { randomUUID } = require('node:crypto');
  const RecoveryStore = require('../../electron/recovery-store.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-ssh-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const entry = { id: randomUUID(), uri: `ssh://${randomUUID()}/home/tester/draft.py`, text: 'unsaved remote text 🪐\n', languageId: 'python' };
  await new RecoveryStore(directory).save(entry);
  const restored = (await new RecoveryStore(directory).list()).entries[0];
  assert.equal(restored.uri, entry.uri); assert.equal(restored.text, entry.text);
});

test('SSH profiles reject invalid addresses, ports and authentication before connecting', () => {
  const valid = { host: 'example.com', username: 'tester' };
  assert.equal(profile(valid).port, 22);
  assert.equal(profile({ ...valid, host: '[::1]', port: '2222' }).host, '::1');
  for (const port of [0, -1, 65536, 1.5, NaN, '', 'invalid']) {
    assert.throws(() => profile({ ...valid, port }), /SSH port/, 'Invalid port: ' + port);
  }
  for (const host of ['', '-host', 'host name', 'host/path', 'host\0']) assert.throws(() => profile({ ...valid, host }), /hostname/);
  assert.throws(() => profile({ ...valid, username: '' }), /username/);
  assert.throws(() => profile({ ...valid, auth: 'unknown' }), /authentication/);
  assert.throws(() => profile({ ...valid, auth: 'key' }), /private key/);
});

test('remote delete and rename safeguards preserve the root, other devices and existing targets', { timeout: 10000 }, async t => {
  const { device, connections, files, input, uri } = await setup(t);
  await connections.connect(input, { password: 'test-password' });
  const before = await files.readFile(uri('remote.txt'));
  await assert.rejects(files.delete(new URI(`ssh://${input.id}/`), { recursive: true }), /root cannot be deleted/);
  await assert.rejects(files.rename(uri('remote.txt'), new URI('ssh://other-device/home/tester/remote.txt'), { overwrite: false }), /between SSH devices/);
  await files.writeFile(uri('target.txt'), Buffer.from('keep target'), { create: true, overwrite: false });
  await assert.rejects(files.rename(uri('remote.txt'), uri('target.txt'), { overwrite: false }), /target already exists/);
  await assert.rejects(files.writeFile(uri('missing.txt'), Buffer.from('no create'), { create: false, overwrite: true }), /does not exist/);
  assert.deepEqual(await files.readFile(uri('remote.txt')), before);
  assert.equal(Buffer.from(await files.readFile(uri('target.txt'))).toString(), 'keep target');
  assert.deepEqual((await fs.readdir(path.join(device.directory, 'project'))).sort(), ['remote.txt', 'target.txt']);
  assert.equal(files.handles.size, 0);
});

test('SFTP permission errors retain their type and connection identity cannot silently change', { timeout: 10000 }, async t => {
  const { connections, files, input, uri } = await setup(t);
  await connections.connect(input, { password: 'test-password' });
  await assert.rejects(files.stat(uri('../..')), error => error.code === 'NoPermissions' && /outside fixture/.test(error.message));
  await assert.rejects(connections.connect({ ...input, username: 'other' }), /as a new connection/);
  assert.equal(connections.sessions.size, 1);
  assert.equal((await connections.list())[0].username, 'tester');
});
