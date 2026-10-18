'use strict';

// Runs inside the built-in Markdown webview, alongside its existing scroll sync.
function followEditedLine() {
  const metadata = document.getElementById('vscode-markdown-preview-data');
  const settings = JSON.parse(metadata.dataset.settings);
  if (!settings.scrollPreviewWithEditor) return;
  let source = settings.source, line, timer, mapped, followingUntil = 0;
  // Native preview scrolling normally reveals the editor's corresponding line.
  // Our own caret-follow scroll must not feed back and move the source viewport.
  window.addEventListener('scroll', event => {
    if (performance.now() < followingUntil) event.stopImmediatePropagation();
  }, true);
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, () => { followingUntil = 0; }, { capture: true, passive: true });
  }
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
      const block = element.tagName === 'CODE' && element.parentElement?.tagName === 'PRE' ? element.parentElement : element;
      const rect = block.getBoundingClientRect();
      // A code block can fill several screens. Follow the selected source line
      // within it instead of trying to fit the whole block into the viewport.
      const lines = element.tagName === 'CODE' ? element.textContent.split('\n').length
        : next ? Number(next.dataset.line) - Number(element.dataset.line) : 1;
      const ratio = Math.min(1, (line - Number(element.dataset.line)) / Math.max(1, lines));
      const top = rect.height > innerHeight ? rect.top + ratio * rect.height : rect.top;
      const bottom = rect.height > innerHeight ? top + 24 : rect.bottom;
      // Reveal only the missing portion. Aligning the entire paragraph to the
      // top on each content update makes typing repeatedly jump across a page.
      const margin = 8;
      const offset = top < margin ? top - margin : bottom > innerHeight - margin ? bottom - innerHeight + margin : 0;
      if (Math.abs(offset) < 1) return;
      followingUntil = performance.now() + 150;
      window.scrollBy({ top: offset, behavior: 'instant' });
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
