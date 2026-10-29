'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const URI = require('@theia/core/lib/common/uri').default;
const { PDF_FILE_TYPES, exportFormat } = require('../../extensions/plain-editor-ui/pdf-file-types.cjs');
const editor = (uri, language = 'plaintext') => ({
  editor: { uri: new URI(uri), getControl: () => ({ getModel: () => ({ getValue: () => 'Document', getLanguageId: () => language }) }) }
});

test('PDF export accepts only supported document extensions, including uppercase and remote paths', () => {
  for (const [extension, format] of Object.entries(PDF_FILE_TYPES)) {
    assert.equal(exportFormat(editor('file:///project/document' + extension)), format);
    assert.equal(exportFormat(editor('file:///project/REPORT' + extension.toUpperCase())), format);
    assert.equal(exportFormat(editor('ssh://device/home/user/document' + extension)), format);
  }
});

test('code, data, unsupported documents and extensionless files cannot be exported as PDF', () => {
  for (const name of ['script.py', 'main.c', 'main.cpp', 'page.js', 'index.ts', 'page.html', 'settings.json', 'data.csv', 'notes.md.py', 'document.pdf', 'document.docx', 'document.rtf', 'image.png', 'README']) {
    assert.equal(exportFormat(editor('file:///project/' + name)), undefined, name);
  }
  assert.equal(exportFormat(editor('untitled:Untitled-1')), undefined);
  assert.equal(exportFormat(editor('file:///notes.txt/script.py', 'markdown')), undefined, 'Language mode and parent folder cannot bypass the file list');
});

test('both Markdown preview widgets support rendered PDF export', () => {
  assert.equal(exportFormat({ viewType: 'markdown.preview' }), 'markdown');
  assert.equal(exportFormat({ viewType: 'vscode.markdown.preview.editor' }), 'markdown');
  assert.equal(exportFormat({ viewType: 'some-extension.preview' }), undefined);
});

test('non-editor panels and documents whose text model is not ready have no PDF action', () => {
  for (const widget of [undefined, {}, { id: 'plain-git' }, { editor: { uri: new URI('file:///notes.txt'), getControl: () => ({ getModel: () => null }) } }]) {
    assert.equal(exportFormat(widget), undefined);
  }
});
