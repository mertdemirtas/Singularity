'use strict';

const { EditorOption } = require('@theia/monaco-editor-core/esm/vs/editor/common/standalone/standaloneEnums');

module.exports = function limitEditorScrolling(editorManager) {
  const registered = new WeakSet();
  const register = widget => {
    const editor = widget.editor?.getControl?.();
    if (!editor?.getOption || !editor.updateOptions || registered.has(editor)) return;
    registered.add(editor);
    const apply = () => {
      const padding = editor.getOption(EditorOption.padding);
      // Keep the first line clear of the tab-row separator. Use Monaco's
      // padding so cursor positions, selections, and scrolling stay aligned.
      const top = Math.max(4, padding.top);
      // Leave ten lines of breathing room instead of Monaco's extra viewport.
      const bottom = Math.min(1000, editor.getOption(EditorOption.lineHeight) * 10);
      if (editor.getOption(EditorOption.scrollBeyondLastLine) || padding.top !== top || padding.bottom !== bottom) {
        editor.updateOptions({ scrollBeyondLastLine: false, padding: { top, bottom } });
      }
    };
    const listener = editor.onDidChangeConfiguration(event => {
      if (event.hasChanged(EditorOption.lineHeight) || event.hasChanged(EditorOption.padding)
        || event.hasChanged(EditorOption.scrollBeyondLastLine)) apply();
    });
    widget.disposed.connect(() => listener.dispose());
    apply();
  };
  editorManager.onCreated(register);
  editorManager.all.forEach(register);
};
