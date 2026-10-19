'use strict';
const documents = require('@theia/plugin-ext/lib/main/browser/documents-main');
const { SaveHookGate } = require('./save-hook-gate.cjs');
const DocumentsMain = documents.DocumentsMainImpl;

// Theia only checks its save timeout *between* extension listeners. A listener
// awaiting a dead language server can therefore block Monaco's save queue forever.
documents.DocumentsMainImpl = class extends DocumentsMain {
  constructor(...args) {
    super(...args);
    const proxy = this.proxy, gate = new SaveHookGate();
    this.proxy = new Proxy(proxy, { get: (target, key) => key === '$acceptModelWillSave'
      ? (...parameters) => gate.run(() => target.$acceptModelWillSave(...parameters), this.saveTimeout)
      : Reflect.get(target, key) });
    this.toDispose.push({ dispose: () => gate.dispose() });
  }
};
