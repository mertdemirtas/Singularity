'use strict';

const { decorate, injectable } = require('@theia/core/shared/inversify');
const { Event } = require('@theia/core/lib/common/event');
const { BinaryBuffer } = require('@theia/core/lib/common/buffer');
const { FileService } = require('@theia/filesystem/lib/browser/file-service');
const { hasOpenReadWriteCloseCapability } = require('@theia/filesystem/lib/common/files');
const { EditorModelService } = require('@theia/plugin-ext/lib/main/browser/text-editor-model-service');
const { EditorsAndDocumentsMain } = require('@theia/plugin-ext/lib/main/browser/editors-and-documents-main');
const { MonacoEditorProvider } = require('@theia/monaco/lib/browser/monaco-editor-provider');

const CHUNK_SIZE = 4 * 1024 * 1024;
const isLarge = model => Boolean(model?.isTooLargeForTokenization?.() || model?.isTooLargeForSyncing?.());

class StreamingFileService extends FileService {
  async doWriteUnbufferedQueued(provider, resource, content) {
    if (content instanceof BinaryBuffer && content.byteLength > 8 * 1024 * 1024 && hasOpenReadWriteCloseCapability(provider)) {
      let offset = 0;
      // Stay in FileService's existing write queue and validation path, but do
      // not send the whole file in one RPC packet (the transport caps at 100 MB).
      const readable = { read() {
        if (offset >= content.byteLength) return null;
        const chunk = content.slice(offset, offset + CHUNK_SIZE);
        offset += chunk.byteLength;
        return chunk;
      } };
      const handle = await provider.open(resource, { create: true });
      try { await this.doWriteReadableBufferedQueued(provider, handle, readable); }
      finally { await provider.close(handle); }
      return;
    }
    return super.doWriteUnbufferedQueued(provider, resource, content);
  }
}
decorate(injectable(), StreamingFileService);

class BoundedEditorModelService extends EditorModelService {
  modelCreated(model) { if (!isLarge(model.textEditorModel)) super.modelCreated(model); }
  getModels() { return super.getModels().filter(model => !isLarge(model.textEditorModel)); }
  get onModelAdded() { return Event.filter(super.onModelAdded, model => !isLarge(model.textEditorModel)); }
  async createModelReference(uri) {
    const reference = await super.createModelReference(uri);
    if (!isLarge(reference.object.textEditorModel)) return reference;
    reference.dispose();
    throw new Error('This document is in large file mode. Extension text processing is disabled; open it in the editor to view or edit it.');
  }
}
decorate(injectable(), BoundedEditorModelService);

class LargeFileEditorProvider extends MonacoEditorProvider {
  async createMonacoEditor(uri, override, toDispose) {
    const editor = await super.createMonacoEditor(uri, override, toDispose);
    if (isLarge(editor.document.textEditorModel)) editor.setShouldDisplayDirtyDiff(false);
    return editor;
  }
  createMonacoEditorOptions(model) {
    const options = super.createMonacoEditorOptions(model);
    if (isLarge(model.textEditorModel)
      || model.textEditorModel.getValueLength() / model.textEditorModel.getLineCount() > 10000) {
      options.wordWrap = 'off';
      options.minimap = { ...options.minimap, enabled: false };
    }
    return options;
  }
  updateMonacoEditorOptions(editor, event) {
    super.updateMonacoEditorOptions(editor, event);
    const model = editor.document.textEditorModel;
    if (isLarge(model)) {
      editor.getControl().updateOptions({ wordWrap: 'off', minimap: { enabled: false } });
      editor.setShouldDisplayDirtyDiff(false);
    }
  }
}
decorate(injectable(), LargeFileEditorProvider);

module.exports = function installLargeFileSupport(rebind) {
  rebind(FileService).to(StreamingFileService).inSingletonScope();
  rebind(EditorModelService).to(BoundedEditorModelService).inSingletonScope();
  rebind(MonacoEditorProvider).to(LargeFileEditorProvider).inSingletonScope();
  // Theia 1.76 publishes every visible editor even when its document is not
  // synchronized. Filter both sides of that delta so extensions never receive
  // an editor whose document they cannot access. Keep normal documents intact.
  const onDelta = EditorsAndDocumentsMain.prototype.onDelta;
  EditorsAndDocumentsMain.prototype.onDelta = function (delta) {
    const active = this.stateComputer.currentState?.editors.get(delta.newActiveEditor);
    return onDelta.call(this, { ...delta,
      addedEditors: delta.addedEditors.filter(snapshot => !isLarge(snapshot.editor.getControl().getModel())),
      removedEditors: delta.removedEditors.filter(snapshot => this.textEditors.has(snapshot.id)),
      newActiveEditor: active && isLarge(active.editor.getControl().getModel()) ? null : delta.newActiveEditor
    });
  };
};
module.exports.isLarge = isLarge;
module.exports.StreamingFileService = StreamingFileService;
