'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { Disposable, DisposableCollection } = require('@theia/core/lib/common/disposable');
function fixture() {
  const scopes = new Set(), openers = new Set(), contextToken = Symbol('contexts'), openerToken = Symbol('openers');
  const services = new Map([
    [contextToken, { createScoped() { const scope = { dispose() { scopes.delete(scope); } }; scopes.add(scope); return scope; } }],
    [openerToken, { registerOpener(opener) { openers.add(opener); return { dispose() { openers.delete(opener); } }; } }]
  ]);
  class Editor {
    onDispose(listener) { this.dispose = listener; }
    onFocusChanged(listener) { this.focus = listener; return Disposable.NULL; }
  }
  class Provider { injectKeybindingResolver(editor) { editor.resolverInstalled = true; } }
  const exports = { module: { exports: {} }, document: { createElement: () => ({}) }, require(id) {
    if (id.endsWith('/inversify')) return { decorate() {}, injectable: () => () => {} };
    if (id.endsWith('/disposable')) return { Disposable, DisposableCollection };
    if (id.endsWith('/monaco-editor-provider')) return { MonacoEditorProvider: Provider };
    if (id.endsWith('/monaco-editor')) return { MonacoEditor: Editor };
    if (id.endsWith('/standaloneServices')) return { StandaloneServices: { get: token => services.get(token) } };
    if (id.endsWith('/contextkey')) return { IContextKeyService: contextToken };
    if (id.endsWith('/opener')) return { IOpenerService: openerToken };
    throw Error(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../extensions/plain-editor-ui/editor-provider-lifecycle.js'), 'utf8'), exports);
  return { provider: new exports.module.exports.LifecycleEditorProvider(), scopes, openers, Editor };
}
test('closing editors releases scoped contexts and link handlers without accumulating registrations', async () => {
  const { provider, scopes, openers, Editor } = fixture();
  for (let i = 0; i < 100; i++) {
    const editor = await provider.doCreateEditor('file:///a.txt', async () => new Editor());
    assert(editor.resolverInstalled); assert.equal(scopes.size, 1); assert.equal(openers.size, 1);
    editor.focus(true); assert.equal(provider.current ?? provider._current, editor);
    editor.dispose(); assert.equal(provider._current, undefined);
    assert.equal(scopes.size, 0); assert.equal(openers.size, 0);
  }
});
test('failed editor creation releases contexts, link handlers and partially acquired resources', async () => {
  const { provider, scopes, openers } = fixture(); let released = false;
  await assert.rejects(provider.doCreateEditor('file:///missing', async (overrides, resources) => {
    resources.push(Disposable.create(() => { released = true; }));
    throw Error('load failed');
  }), /load failed/);
  assert(released); assert.equal(scopes.size, 0); assert.equal(openers.size, 0);
});
