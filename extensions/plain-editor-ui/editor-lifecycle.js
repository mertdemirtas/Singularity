'use strict';

const { decorate, injectable } = require('@theia/core/shared/inversify');
const { EditorContribution } = require('@theia/editor/lib/browser/editor-contribution');

class LiveEditorContribution extends EditorContribution {
  setCursorPositionStatus(statusBar, editor) {
    // Closing a merge editor disposes several Monaco panes together. During
    // the focus transition, a pane can still be current after losing its model;
    // its cursor getter then throws because getPosition() returns null.
    const control = editor?.getControl?.();
    return super.setCursorPositionStatus(statusBar, control?.getPosition?.() === null ? undefined : editor);
  }
}
decorate(injectable(), LiveEditorContribution);

module.exports = rebind => rebind(EditorContribution).to(LiveEditorContribution).inSingletonScope();
