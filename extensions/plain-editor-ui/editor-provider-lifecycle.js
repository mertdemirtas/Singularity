'use strict';

const { decorate, injectable } = require('@theia/core/shared/inversify');
const { Disposable, DisposableCollection } = require('@theia/core/lib/common/disposable');
const { MonacoEditorProvider } = require('@theia/monaco/lib/browser/monaco-editor-provider');
const { MonacoEditor } = require('@theia/monaco/lib/browser/monaco-editor');
const { StandaloneServices } = require('@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices');
const { IContextKeyService } = require('@theia/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey');
const { IOpenerService } = require('@theia/monaco-editor-core/esm/vs/platform/opener/common/opener');

// Theia 1.76 creates a scoped context and opener for every editor but does not
// release either. The parent context retains their DOM nodes and listeners.
class LifecycleEditorProvider extends MonacoEditorProvider {
  async doCreateEditor(uri, factory) {
    const resources = new DisposableCollection();
    const context = StandaloneServices.get(IContextKeyService).createScoped(document.createElement('div'));
    resources.push(context);
    resources.push(StandaloneServices.get(IOpenerService).registerOpener({
      open: (target, options) => this.interceptOpen(target, options)
    }));
    try {
      const editor = await factory([[IContextKeyService, context]], resources);
      editor.onDispose(() => resources.dispose());
      if (editor instanceof MonacoEditor) {
        this.injectKeybindingResolver(editor);
        resources.push(editor.onFocusChanged(focused => { if (focused) this._current = editor; }));
        resources.push(Disposable.create(() => { if (this._current === editor) this._current = undefined; }));
      }
      return editor;
    } catch (error) {
      resources.dispose();
      throw error;
    }
  }
}
decorate(injectable(), LifecycleEditorProvider);
module.exports = { LifecycleEditorProvider };
