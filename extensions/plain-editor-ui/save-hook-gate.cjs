'use strict';

class SaveHookGate {
  constructor(warn = console.warn) { this.warn = warn; this.stalled = new Set(); this.active = new Set(); this.disposed = false; }
  async run(operation, timeout = 1750) {
    // A hung host must not collect another unresolved RPC on every Ctrl+S.
    if (this.disposed || this.stalled.size) return [];
    const pending = Promise.resolve().then(operation);
    const task = {};
    this.active.add(task);
    let timer;
    const finish = () => this.stalled.delete(pending);
    pending.then(finish, finish);
    try {
      return await Promise.race([pending, new Promise(resolve => {
        task.cancel = () => resolve([]);
        timer = setTimeout(() => {
          this.stalled.add(pending);
          this.warn('Singularity: an extension save hook timed out; saving without its edits.');
          resolve([]);
        }, timeout);
      })]);
    } catch (error) {
      this.warn('Singularity: an extension save hook failed; saving without its edits.', error);
      return [];
    } finally { clearTimeout(timer); this.active.delete(task); }
  }
  dispose() { this.disposed = true; for (const task of this.active) task.cancel(); this.active.clear(); this.stalled.clear(); }
}
module.exports = { SaveHookGate };
