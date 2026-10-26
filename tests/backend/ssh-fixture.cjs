'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { generateKeyPairSync } = require('node:crypto');
const { Server, utils: { sftp: { STATUS_CODE: S, flagsToString } } } = require('ssh2');
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
async function fixture() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-ssh-device-')));
  await fs.mkdir(path.join(directory, 'project')); await fs.writeFile(path.join(directory, 'project', 'remote.txt'), 'hello from the remote device\n');
  const clients = new Set(), writes = [], shellInput = [], state = { failRename: false, failWrite: false };
  const home = '/home/tester';
  const remote = name => path.posix.resolve(home, name);
  const local = name => { const resolved = remote(name); if (resolved !== home && !resolved.startsWith(home + '/')) throw Object.assign(Error('outside fixture'), { code: 'EACCES' }); return path.join(directory, path.posix.relative(home, resolved)); };
  const attrs = value => ({ mode: value.mode, uid: value.uid, gid: value.gid, size: value.size, atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) });
  const server = new Server({ hostKeys: [hostKey] }, client => {
    client.setNoDelay(true); clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
      if (context.username === 'tester' && ((context.method === 'password' && context.password === 'test-password') || context.method === 'publickey')) context.accept(); else context.reject();
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', accept => accept()); session.on('window-change', accept => accept?.());
      session.on('shell', accept => { const stream = accept(); stream.write('TEST SSH READY\r\n'); stream.on('data', bytes => { shellInput.push(bytes.toString()); stream.write('REMOTE: ' + bytes.toString()); }); });
      session.on('sftp', accept => {
        const sftp = accept(), handles = new Map(); let next = 0;
        const handle = object => { const key = String(++next); handles.set(key, object); return Buffer.from(key); };
        const request = (event, fn) => sftp.on(event, (id, ...args) => Promise.resolve().then(() => fn(id, ...args)).catch(error => {
          sftp.status(id, error.code === 'ENOENT' ? S.NO_SUCH_FILE : ['EACCES', 'EPERM'].includes(error.code) ? S.PERMISSION_DENIED : S.FAILURE, error.message);
        }));
        request('REALPATH', async (id, name) => { const resolved = await fs.realpath(local(name)), relative = path.relative(directory, resolved); if (relative.startsWith('..')) throw Object.assign(Error('outside fixture'), { code: 'EACCES' }); const canonical = path.posix.join(home, relative.split(path.sep).join('/')); sftp.name(id, [{ filename: canonical, longname: canonical, attrs: {} }]); });
        for (const method of ['STAT', 'LSTAT']) request(method, async (id, name) => sftp.attrs(id, attrs(await fs[method.toLowerCase()](local(name)))));
        request('OPENDIR', async (id, name) => sftp.handle(id, handle({ entries: await Promise.all((await fs.readdir(local(name))).map(async filename => ({ filename, longname: filename, attrs: attrs(await fs.lstat(path.join(local(name), filename))) }))) })));
        request('READDIR', async (id, key) => { const value = handles.get(key.toString()); if (value.entries) { sftp.name(id, value.entries); value.entries = undefined; } else sftp.status(id, S.EOF); });
        request('OPEN', async (id, name, flags, properties) => { const file = await fs.open(local(name), flagsToString(flags), properties.mode); sftp.handle(id, handle({ file })); });
        request('CLOSE', async (id, key) => { const value = handles.get(key.toString()); handles.delete(key.toString()); await value?.file?.close(); sftp.status(id, S.OK); });
        request('READ', async (id, key, offset, length) => { const buffer = Buffer.alloc(length), { bytesRead } = await handles.get(key.toString()).file.read(buffer, 0, length, offset); if (bytesRead) sftp.data(id, buffer.subarray(0, bytesRead)); else sftp.status(id, S.EOF); });
        request('WRITE', async (id, key, offset, data) => { if (state.failWrite) throw Error('simulated write failure'); writes.push(data.length); await handles.get(key.toString()).file.write(data, 0, data.length, offset); sftp.status(id, S.OK); });
        request('MKDIR', async (id, name) => { await fs.mkdir(local(name)); sftp.status(id, S.OK); });
        request('RMDIR', async (id, name) => { await fs.rmdir(local(name)); sftp.status(id, S.OK); });
        request('REMOVE', async (id, name) => { await fs.unlink(local(name)); sftp.status(id, S.OK); });
        request('RENAME', async (id, from, to) => { if (state.failRename) throw Error('simulated replacement failure'); await fs.rename(local(from), local(to)); sftp.status(id, S.OK); });
        sftp.on('close', () => { for (const value of handles.values()) value.file?.close().catch(() => {}); handles.clear(); });
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { directory, port: server.address().port, hostKey, state, writes, shellInput,
    async close() { for (const client of clients) client._sock.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); } };
}
module.exports = { fixture };
