'use strict';

const URI = require('@theia/core/lib/common/uri').default;
const ENABLED = 'plainEditor.recovery.enabled';

function recoveryUri(entry) {
  const name = new URI(entry.uri).path.base || 'Untitled.txt';
  return new URI().withScheme('untitled').withPath(`/Recovered-${name}`).withQuery(entry.id).toString();
}

class RecoveryController {
  constructor({ api, manager, preferences, messages, openRecovery, delay = 1000, maxWait = 5000 }) {
    Object.assign(this, { api, manager, preferences, messages, openRecovery, delay, maxWait });
    this.documents = new Map();
    this.restoring = new Map();
    this.reportedError = false;
  }

  get enabled() { return this.preferences.get(ENABLED, true); }

  report(error) {
    console.error('Singularity: recovery', error);
    if (!this.reportedError) {
      this.reportedError = true;
      this.messages.error('Could not update recovery copies. Save your work manually. ' + error.message);
    }
  }

  operation(promise) {
    promise.then(() => { this.reportedError = false; }, error => this.report(error));
    return promise;
  }

  async start({ force = false } = {}) {
    this.manager.onCreated(widget => this.track(widget));
    this.manager.all.forEach(widget => this.track(widget));
    this.preferences.onPreferenceChanged(change => {
      if (change.preferenceName !== ENABLED) return;
      for (const session of this.documents.values()) {
        clearTimeout(session.timer);
        session.firstChange = undefined;
        if (this.enabled && session.document.dirty) this.schedule(session);
      }
    });
    if (this.enabled || force) await this.recover();
  }

  track(widget) {
    const document = widget.editor?.document;
    if (!document || this.documents.has(document) || !/^(file|untitled|ssh):/.test(document.uri)) return;
    const entry = this.restoring.get(document.uri);
    const session = { document, id: entry?.id || crypto.randomUUID(), uri: entry?.uri || document.uri, backedUp: Boolean(entry) };
    this.documents.set(document, session);
    const changed = () => {
      if (document.dirty) {
        if (this.enabled) this.schedule(session);
      } else {
        clearTimeout(session.timer);
        session.firstChange = undefined;
        if (session.backedUp) this.clear(session);
      }
    };
    const listeners = [document.onContentChanged(changed), document.onDirtyChanged(changed)];
    const disposed = (document.textEditorModel?.onWillDispose || document.onWillDispose || document.onDispose)(() => {
      clearTimeout(session.timer);
      // Unexpected disposal of a dirty model must not discard its recovery copy.
      if (document.dirty && this.enabled) this.persist(session);
      this.documents.delete(document);
      listeners.forEach(listener => listener.dispose());
      disposed.dispose();
    });
    changed();
  }

  schedule(session) {
    clearTimeout(session.timer);
    session.firstChange ??= Date.now();
    const wait = Math.min(this.delay, Math.max(0, session.firstChange + this.maxWait - Date.now()));
    session.timer = setTimeout(() => this.persist(session), wait);
  }

  clear(session) {
    return this.operation(this.api.removeRecovery(session.id).then(() => {
      if (!session.document.dirty) session.backedUp = false;
    }));
  }

  persist(session, force = false) {
    clearTimeout(session.timer);
    session.firstChange = undefined;
    const document = session.document;
    if (!document.dirty) return session.backedUp ? this.clear(session) : Promise.resolve();
    if (!this.enabled && !force) return Promise.resolve();
    try {
      const snapshot = document.createSnapshot?.(true);
      const text = snapshot ? ('value' in snapshot ? snapshot.value : snapshot.read()) : document.getText();
      session.backedUp = true;
      return this.operation(this.api.saveRecovery({ id: session.id, uri: session.uri, text: text ?? '',
        languageId: document.languageId || 'plaintext', encoding: document.getEncoding?.() }));
    } catch (error) {
      this.report(error);
      const rejected = Promise.reject(error);
      rejected.catch(() => {});
      return rejected;
    }
  }

  async flush({ closing = false, force = false } = {}) {
    const results = await Promise.allSettled([...this.documents.values()].map(session => this.persist(session, force)));
    try {
      await this.api.flushRecovery();
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    } catch (error) {
      // Once the user has saved or explicitly discarded every document, failed
      // cleanup must not trap the app in an unclosable window.
      if (!closing || [...this.documents.values()].some(session => session.document.dirty)) throw error;
      this.messages.warn('Some recovery copies could not be removed. They may appear again on the next launch.');
    }
  }

  async recover() {
    if (this.recovering) return this.recovering;
    this.recovering = this.restore().finally(() => { this.recovering = undefined; });
    return this.recovering;
  }

  async restore() {
    this.restoreSucceeded = false;
    try {
      const { entries, errors } = await this.api.listRecovery();
      if (errors.length) this.messages.warn('Some recovery copies could not be read and were kept on disk. ' + errors.join('; '));
      let count = 0, failed = errors.length > 0;
      for (const entry of entries) {
        if ([...this.documents.values()].some(session => session.id === entry.id)) continue;
        const uri = recoveryUri(entry);
        this.restoring.set(uri, entry);
        try {
          const widget = await this.openRecovery(entry, uri);
          this.track(widget);
          count++;
        } catch (error) {
          failed = true;
          this.messages.error(`Could not reopen a recovery copy. It is still kept on disk. ${error.message}`);
        } finally { this.restoring.delete(uri); }
      }
      if (count) this.messages.info(`Recovered ${count} unsaved document${count === 1 ? '' : 's'} in separate tabs. Use Save As to keep them.`);
      this.restoreSucceeded = !failed;
      return count;
    } catch (error) { this.report(error); return 0; }
  }
}

module.exports = { RecoveryController, ENABLED, recoveryUri };
