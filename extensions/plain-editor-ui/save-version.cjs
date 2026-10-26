'use strict';
// Adapted from Eclipse Theia's MonacoEditorModel.doSave.
// Copyright (C) 2017 TypeFox and others.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
const MANUAL_SAVE = 1; // TextDocumentSaveReason.Manual

// Keep edits made during disk/network I/O dirty. Theia 1.76 otherwise only
// compares versions when the save token was cancelled; typing does not cancel it.
async function saveWithVersion(resourceApi, token, overwriteEncoding, options) {
  if (token.isCancellationRequested || !this.resource.saveContents) return;
  await this.fireWillSaveModel(token, options);
  if (token.isCancellationRequested) return;
  const changes = [...this.contentChanges];
  if (!changes.length && !this.resource.initiallyDirty && !overwriteEncoding && options?.saveReason !== MANUAL_SAVE) return;
  const savedVersion = this.model.getAlternativeVersionId();
  const contentLength = this.model.getValueLength(), content = this.model.getValue();
  try {
    await resourceApi.Resource.save(this.resource, { changes, content, contentLength,
      options: { encoding: this.getEncoding(), overwriteEncoding, version: this.resourceVersion } }, token);
    this.contentChanges.splice(0, changes.length);
    this.resourceVersion = this.resource.version;
    this.updateContentEncoding();
    this.setValid(true);
    this.bufferSavedVersionId = savedVersion;
    this.setDirty(this.model.getAlternativeVersionId() !== savedVersion);
    this.fireDidSaveModel();
  } catch (error) {
    if (!resourceApi.ResourceError.OutOfSync.is(error)) throw error;
  }
}
module.exports = { saveWithVersion };
