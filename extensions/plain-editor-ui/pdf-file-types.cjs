'use strict';

// Keep this list limited to document formats supported by our PDF renderers.
const PDF_FILE_TYPES = Object.freeze({
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text'
});
const markdownPreview = widget => ['markdown.preview', 'vscode.markdown.preview.editor'].includes(widget?.viewType);
const textModel = widget => {
  const model = widget?.editor?.getControl?.()?.getModel?.();
  return typeof model?.getValue === 'function' ? model : undefined;
};
function exportFormat(widget) {
  if (markdownPreview(widget)) return 'markdown';
  const extension = widget?.editor?.uri?.path?.ext?.toLowerCase();
  if (!Object.hasOwn(PDF_FILE_TYPES, extension) || !textModel(widget)) return undefined;
  return PDF_FILE_TYPES[extension];
}

module.exports = { PDF_FILE_TYPES, markdownPreview, textModel, exportFormat };
