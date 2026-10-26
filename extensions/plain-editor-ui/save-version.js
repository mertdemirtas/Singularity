'use strict';
const { MonacoEditorModel } = require('@theia/monaco/lib/browser/monaco-editor-model');
const resource = require('@theia/core/lib/common/resource');
const { saveWithVersion } = require('./save-version.cjs');
MonacoEditorModel.prototype.doSave = function (token, overwriteEncoding, options) {
  return saveWithVersion.call(this, resource, token, overwriteEncoding, options);
};
