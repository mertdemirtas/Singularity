'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

class StateStore {
  constructor(filename) {
    this.filename = filename;
    this.pending = Promise.resolve();
    this.loaded = undefined;
  }
  load() {
    if (!this.loaded) this.loaded = fs.readFile(this.filename, 'utf8')
      .then(text => Object.assign(Object.create(null), JSON.parse(text)))
      .catch(error => {
        if (error.code === 'ENOENT') return Object.create(null);
        throw error;
      });
    return this.loaded;
  }
  async get(key) {
    await this.pending;
    return (await this.load())[key];
  }
  set(key, value) {
    const update = this.pending.then(async () => {
      const data = await this.load();
      if (value === undefined) delete data[key];
      else data[key] = value;
      await fs.mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      const handle = await fs.open(`${this.filename}.tmp`, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(`${this.filename}.tmp`, this.filename);
      if (process.platform !== 'win32') {
        const directory = await fs.open(path.dirname(this.filename), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
      this.failure = undefined;
    });
    this.pending = update.catch(error => { this.failure = error; });
    return update;
  }
  async flush() {
    await this.pending;
    if (this.failure) throw this.failure;
  }
}
module.exports = StateStore;
