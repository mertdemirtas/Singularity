'use strict';

// Runs inside the built-in Markdown webview, alongside its existing scroll sync.
function followEditedLine() {
  const metadata = document.getElementById('vscode-markdown-preview-data');
  const settings = JSON.parse(metadata.dataset.settings);
  if (!settings.scrollPreviewWithEditor) return;
  let source = settings.source, line, timer, mapped;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Reading the preview must not move it, or take focus away from the source.
      if (line === undefined || document.hasFocus()) return;
      mapped ||= Array.from(document.querySelectorAll('.code-line[data-line]'))
        .filter(element => element.getClientRects().length && !['UL', 'OL'].includes(element.tagName));
      let element, next;
      for (const candidate of mapped) {
        if (Number(candidate.dataset.line) > line) { next = candidate; break; }
        element = candidate;
      }
      if (!element) return;
      const rect = element.getBoundingClientRect();
      // A code block can fill several screens. Follow the selected source line
      // within it instead of trying to fit the whole block into the viewport.
      const ratio = next ? Math.min(1, (line - Number(element.dataset.line)) /
        Math.max(1, Number(next.dataset.line) - Number(element.dataset.line))) : 0;
      const top = rect.height > innerHeight ? rect.top + ratio * rect.height : rect.top;
      const bottom = rect.height > innerHeight ? top + 24 : rect.bottom;
      if (top >= 0 && bottom <= innerHeight) return;
      // Let the native handler map the source line to pixels and suppress its
      // scroll feedback to the editor. Never focus the preview to reveal a line.
      window.postMessage({ type: 'updateView', line, source }, location.origin);
    }, 100);
  };
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'updateContent' && message.source !== source) {
      source = message.source;
      line = undefined;
      mapped = undefined;
    }
    if (message.type === 'onDidChangeTextEditorSelection' && message.source === source && Number.isFinite(message.line)) {
      line = message.line;
      schedule();
    }
  });
  window.addEventListener('vscode.markdown.updateContent', () => { mapped = undefined; schedule(); });
}

function enhanceMarkdownHtml(html) {
  if (!html.includes('id="vscode-markdown-preview-data"') || html.includes('id="singularity-markdown-follow"')) return html;
  const nonce = html.match(/<script\b[^>]*\bnonce=("[^"]+"|'[^']+')/i)?.[1];
  if (!nonce) return html;
  return html.replace(/<\/body>/i, `<script id="singularity-markdown-follow" nonce=${nonce}>(${followEditedLine.toString()})();</script></body>`);
}

module.exports = () => {
  const { WebviewWidget } = require('@theia/plugin-ext/lib/main/browser/webview/webview');
  const preprocess = WebviewWidget.prototype.preprocessHtml;
  WebviewWidget.prototype.preprocessHtml = function (html) {
    return enhanceMarkdownHtml(preprocess.call(this, html));
  };
};
module.exports.enhanceMarkdownHtml = enhanceMarkdownHtml;
module.exports.followEditedLine = followEditedLine;
