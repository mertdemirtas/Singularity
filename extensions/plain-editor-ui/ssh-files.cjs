'use strict';
const path = require('node:path').posix, { randomUUID } = require('node:crypto');
const URI = require('@theia/core/lib/common/uri').default;
const { Emitter, Event } = require('@theia/core/lib/common/event');
const { FileSystemProviderError, FileSystemProviderErrorCode: Code, FileType } = require('@theia/filesystem/lib/common/files');
const { call } = require('./ssh-connections.cjs');
const FileChangeType = { UPDATED: 0, ADDED: 1, DELETED: 2 };
const missing = error => error.code === 2 || error.code === 'ENOENT';
function failure(error) {
  if (error instanceof FileSystemProviderError) return error;
  const code = missing(error) ? Code.FileNotFound : [3, 'EACCES', 'EPERM'].includes(error.code) ? Code.NoPermissions : Code.Unavailable;
  return new FileSystemProviderError(error.message || 'The SSH device is unavailable.', code);
}
const type = attrs => attrs.isDirectory() ? FileType.Directory : attrs.isSymbolicLink() ? FileType.SymbolicLink : FileType.File;
const stat = attrs => ({ type: type(attrs), size: attrs.size, mtime: attrs.mtime * 1000, ctime: attrs.mtime * 1000 });

class SshFiles {
  constructor(connections) {
    this.connections = connections; this.capabilities = 2 | 4 | 1024; // read/write, buffered I/O, case-sensitive paths
    this.events = new Emitter(); this.errors = new Emitter();
    this.onDidChangeFile = this.events.event; this.onFileWatchError = this.errors.event; this.onDidChangeCapabilities = Event.None;
    this.handles = new Map(); this.sequence = 0; this.watches = new Set(); this.disposed = false;
    this.onDisconnect = id => { for (const [fd, record] of this.handles) if (record.id === id) this.handles.delete(fd); };
    connections.on('disconnected', this.onDisconnect);
  }
  async location(uri) {
    if (uri.scheme !== 'ssh' || !uri.authority || uri.path.toString().includes('\0')) throw failure(Error('Invalid SSH file address.'));
    try { return { session: await this.connections.get(uri.authority), name: uri.path.toString() || '/', id: uri.authority }; }
    catch (error) { throw failure(error); }
  }
  changed(uri, change = FileChangeType.UPDATED) { this.events.fire([{ resource: uri, type: change }]); }
  async stat(uri) {
    if (!this.connections.sessions.has(uri.authority)) {
      const saved = (await this.connections.profiles()).find(value => value.id === uri.authority);
      if (saved && uri.path.toString().replace(/\/$/, '') === saved.folder.replace(/\/$/, '')) return { type: FileType.Directory, size: 0, mtime: 0, ctime: 0 };
    }
    const { session, name } = await this.location(uri); try { return stat(await call(session.sftp, 'stat', name)); } catch (error) { throw failure(error); } }
  async readdir(uri) {
    if (!this.connections.sessions.has(uri.authority)) return [];
    const { session, name } = await this.location(uri);
    try {
      const entries = (await call(session.sftp, 'readdir', name)).filter(entry => !['.', '..'].includes(entry.filename));
      const result = entries.map(entry => [entry.filename, type(entry.attrs)]), links = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.attrs.isSymbolicLink());
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, links.length) }, async () => {
        while (next < links.length) {
          const { entry, index } = links[next++];
          try { result[index][1] |= type(await call(session.sftp, 'stat', path.join(name, entry.filename))); } catch { /* Broken links remain visible. */ }
        }
      }));
      return result;
    } catch (error) { throw failure(error); }
  }
  async mkdir(uri) { const { session, name } = await this.location(uri); try { await call(session.sftp, 'mkdir', name); this.changed(uri, FileChangeType.ADDED); } catch (error) { throw failure(error); } }
  async optionalStat(sftp, name, method = 'stat') {
    try { return await call(sftp, method, name); } catch (error) { if (missing(error)) return undefined; throw error; }
  }
  async open(uri, options) {
    const { session, name, id } = await this.location(uri), sftp = session.sftp;
    let temporary;
    try {
      let target = name;
      const link = await this.optionalStat(sftp, name, 'lstat');
      if (link?.isSymbolicLink()) target = await call(sftp, 'realpath', name);
      const before = await this.optionalStat(sftp, target);
      if (before?.isDirectory()) throw new FileSystemProviderError('This path is a folder.', Code.FileIsADirectory);
      if (!before && !options.create) throw new FileSystemProviderError('The remote file does not exist.', Code.FileNotFound);
      temporary = options.create ? path.join(path.dirname(target), `.${path.basename(target)}.singularity-${randomUUID()}.tmp`) : undefined;
      const handle = await call(sftp, 'open', temporary || target, options.create ? 'wx' : 'r', before ? before.mode & 0o777 : 0o666);
      const fd = ++this.sequence;
      this.handles.set(fd, { session, id, handle, target, temporary, uri, before });
      return fd;
    } catch (error) {
      if (temporary) await call(sftp, 'unlink', temporary).catch(() => {});
      throw failure(error);
    }
  }
  handle(fd) { const record = this.handles.get(fd); if (!record || !record.session.alive) throw failure(Error('The SSH file handle has closed. Retry after reconnecting.')); return record; }
  async read(fd, position, bytes, offset, length) {
    const { session, handle } = this.handle(fd), buffer = Buffer.alloc(Math.min(length, 65536, bytes.byteLength - offset));
    try { const count = await call(session.sftp, 'read', handle, buffer, 0, buffer.length, position); bytes.set(buffer.subarray(0, count), offset); return count; }
    catch (error) { throw failure(error); }
  }
  async write(fd, position, bytes, offset, length) {
    const record = this.handle(fd);
    if (!record.temporary) throw failure(Error('This SSH file was opened for reading.'));
    try { await call(record.session.sftp, 'write', record.handle, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset, length, position); return length; }
    catch (error) { record.failed = true; throw failure(error); }
  }
  async replace(sftp, source, target) {
    try { await call(sftp, 'ext_openssh_rename', source, target); }
    catch (error) {
      if (error.code !== 8 && !/unsupported|does not support/i.test(error.message)) throw error;
      // Standard SFTP rename may refuse replacement. Never delete the original
      // first: failure must leave the existing document intact.
      await call(sftp, 'rename', source, target);
    }
  }
  async close(fd) {
    const record = this.handle(fd); this.handles.delete(fd);
    const { session, handle, temporary, target, before, uri } = record, sftp = session.sftp;
    try {
      await call(sftp, 'close', handle);
      if (temporary && !record.failed) {
        const current = await this.optionalStat(sftp, target);
        if (Boolean(current) !== Boolean(before) || (before && (before.mtime !== current.mtime || before.size !== current.size))) throw Error('The remote file changed while saving. Reload it before trying again.');
        await this.replace(sftp, temporary, target);
        this.changed(uri, before ? FileChangeType.UPDATED : FileChangeType.ADDED);
      }
    } catch (error) { throw failure(error); }
    finally { if (temporary) await call(sftp, 'unlink', temporary).catch(() => {}); }
  }
  async readFile(uri) {
    const fd = await this.open(uri, { create: false }), chunks = [];
    try {
      let position = 0;
      for (;;) { const bytes = new Uint8Array(65536), count = await this.read(fd, position, bytes, 0, bytes.length); if (!count) break; chunks.push(bytes.subarray(0, count)); position += count; }
      return Buffer.concat(chunks);
    } finally { await this.close(fd); }
  }
  async writeFile(uri, bytes, options) {
    const { session, name } = await this.location(uri), before = await this.optionalStat(session.sftp, name);
    if (before && !options.overwrite) throw new FileSystemProviderError('The remote file already exists.', Code.FileExists);
    if (!before && !options.create) throw new FileSystemProviderError('The remote file does not exist.', Code.FileNotFound);
    const fd = await this.open(uri, { create: true });
    try { for (let offset = 0; offset < bytes.byteLength; offset += 65536) await this.write(fd, offset, bytes, offset, Math.min(65536, bytes.byteLength - offset)); }
    catch (error) { this.handle(fd).failed = true; throw error; }
    finally { await this.close(fd); }
  }
  async delete(uri, options) {
    const { session, name } = await this.location(uri), sftp = session.sftp;
    if (path.normalize(name) === '/') throw new FileSystemProviderError('The remote filesystem root cannot be deleted.', Code.NoPermissions);
    const remove = async name => {
      const attrs = await call(sftp, 'lstat', name);
      if (attrs.isDirectory()) {
        if (options.recursive) for (const entry of await call(sftp, 'readdir', name)) if (!['.', '..'].includes(entry.filename)) await remove(path.join(name, entry.filename));
        await call(sftp, 'rmdir', name);
      } else await call(sftp, 'unlink', name);
    };
    try { await remove(name); this.changed(uri, FileChangeType.DELETED); } catch (error) { throw failure(error); }
  }
  async rename(source, target, options) {
    if (source.authority !== target.authority) throw failure(Error('Move files between SSH devices with Copy and Paste.'));
    const { session, name } = await this.location(source), targetName = (await this.location(target)).name;
    if (name === targetName) return;
    try {
      const exists = await this.optionalStat(session.sftp, targetName);
      if (exists && !options.overwrite) throw new FileSystemProviderError('The target already exists.', Code.FileExists);
      if (options.overwrite) await this.replace(session.sftp, name, targetName); else await call(session.sftp, 'rename', name, targetName);
      this.events.fire([{ resource: source, type: FileChangeType.DELETED }, { resource: target, type: FileChangeType.ADDED }]);
    } catch (error) { throw failure(error); }
  }
  watch(uri) {
    const entry = { uri, snapshot: undefined }; this.watches.add(entry);
    if (!this.timer) { this.timer = setInterval(() => this.poll(), 3000); this.timer.unref(); }
    return { dispose: () => { this.watches.delete(entry); if (!this.watches.size) { clearInterval(this.timer); this.timer = undefined; } } };
  }
  async poll() {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      // Watch only requested paths. Never recursively download a project tree.
      const entries = [...this.watches]; let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (index < entries.length) {
          const entry = entries[index++]; if (!this.connections.sessions.has(entry.uri.authority)) continue;
          try {
            const { session, name } = await this.location(entry.uri), attrs = await call(session.sftp, 'stat', name);
            const snapshot = attrs.isDirectory() ? JSON.stringify((await call(session.sftp, 'readdir', name)).map(item => [item.filename, item.attrs.mtime, item.attrs.size]).sort()) : `${attrs.mtime}:${attrs.size}`;
            if (entry.snapshot !== undefined && entry.snapshot !== snapshot) this.changed(entry.uri);
            entry.snapshot = snapshot;
          } catch (error) { if (missing(error)) this.changed(entry.uri, FileChangeType.DELETED); }
        }
      }));
    } finally { this.polling = false; }
  }
  dispose() {
    this.disposed = true; clearInterval(this.timer); this.watches.clear(); this.connections.removeListener('disconnected', this.onDisconnect);
    for (const record of this.handles.values()) {
      call(record.session.sftp, 'close', record.handle).catch(() => {});
      if (record.temporary) call(record.session.sftp, 'unlink', record.temporary).catch(() => {});
    }
    this.handles.clear(); this.connections.dispose(); this.events.dispose(); this.errors.dispose();
  }
}
module.exports = { SshFiles, failure };
