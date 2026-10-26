'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function validate(entry) {
  if (!entry || !validId(entry.id) || typeof entry.text !== 'string'
    || typeof entry.uri !== 'string' || entry.uri.length > 32768
    || !/^(file|untitled|ssh):/.test(entry.uri)
    || typeof entry.languageId !== 'string' || entry.languageId.length > 160
    || (entry.encoding !== undefined && (typeof entry.encoding !== 'string' || entry.encoding.length > 160))) {
    throw new Error('Invalid recovery document.');
  }
  new URL(entry.uri);
}

class RecoveryStore {
  constructor(directory) {
    this.directory = directory;
    this.pending = Promise.resolve();
    this.failures = new Map();
  }

  enqueue(id, operation) {
    const result = this.pending.then(operation);
    this.pending = result.then(() => { this.failures.delete(id); }, error => { this.failures.set(id, error); });
    return result;
  }

  save(entry) {
    return this.enqueue(entry?.id, async () => {
      validate(entry);
      const snapshot = { version: 1, id: entry.id, uri: entry.uri, text: entry.text,
        languageId: entry.languageId, encoding: entry.encoding, updatedAt: Date.now() };
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const filename = path.join(this.directory, `${entry.id}.json`);
      const handle = await fs.open(`${filename}.tmp`, 'w', 0o600);
      try {
        await handle.writeFile(JSON.stringify(snapshot));
        await handle.sync();
      } finally { await handle.close(); }
      await fs.rename(`${filename}.tmp`, filename);
      // Sync the directory entry too, where directory handles are supported.
      if (process.platform !== 'win32') {
        const directory = await fs.open(this.directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    });
  }

  remove(id) {
    return this.enqueue(id, async () => {
      if (!validId(id)) throw new Error('Invalid recovery document ID.');
      for (const suffix of ['.json', '.json.tmp']) {
        await fs.rm(path.join(this.directory, id + suffix), { force: true });
      }
    });
  }

  list() {
    return this.enqueue('list', () => this.readEntries());
  }

  async readEntries() {
    let files;
    try { files = await fs.readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return { entries: [], errors: [] }; throw error; }
    const entries = new Map(), failures = new Map();
    // A complete temporary file can survive a crash before its atomic rename.
    // Read committed copies first, then prefer a valid pending copy if present.
    for (const filename of files.sort((a, b) => Number(a.endsWith('.tmp')) - Number(b.endsWith('.tmp')))) {
      const id = filename.replace(/\.json(?:\.tmp)?$/, '');
      if (!validId(id) || !/\.json(?:\.tmp)?$/.test(filename)) continue;
      try {
        const entry = JSON.parse(await fs.readFile(path.join(this.directory, filename), 'utf8'));
        validate(entry);
        if (entry.id !== id || entry.version !== 1 || !Number.isFinite(entry.updatedAt)) throw new Error('Unsupported or damaged recovery copy.');
        entries.set(id, entry);
      } catch (error) { failures.set(id, `${filename}: ${error.message}`); }
    }
    return { entries: [...entries.values()].sort((a, b) => a.updatedAt - b.updatedAt),
      errors: [...failures].filter(([id]) => !entries.has(id)).map(([, error]) => error) };
  }

  async flush() {
    await this.pending;
    if (this.failures.size) throw this.failures.values().next().value;
  }
}

module.exports = RecoveryStore;
