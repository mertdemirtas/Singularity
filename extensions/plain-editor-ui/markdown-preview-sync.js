'use strict';

// Runs before the built-in Markdown scripts. One controller owns source-driven
// scrolling; the extension still renders Markdown, highlights selections, saves
// preview state, and handles links and deliberate preview-to-source scrolling.
function synchronizePreview() {
  const settings = JSON.parse(document.getElementById('vscode-markdown-preview-data').dataset.settings);
  if (!settings.scrollPreviewWithEditor) return;
  let source = settings.source, directive, viewportLine, frame, mapped, following = false, previewOwnsScroll = false, lastIntent;
  const acquire = window.acquireVsCodeApi;
  window.acquireVsCodeApi = () => {
    const api = acquire();
    return Object.freeze({ ...api, postMessage(message) {
      // Keep native scroll-position persistence. Suppress only feedback from
      // source-driven scrolling, until the reader deliberately scrolls again.
      if (following && message?.type === 'revealLine') return;
      return api.postMessage(message);
    } });
  };
  window.acquireTheiaApi = window.acquireVsCodeApi;
  const readPreview = () => {
    following = false;
    previewOwnsScroll = true;
    directive = undefined;
    document.documentElement.style.overflowAnchor = '';
  };
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, readPreview, { capture: true, passive: true });
  }
  const mappings = () => mapped ||= Array.from(document.querySelectorAll('.code-line[data-line]'))
    .filter(element => element.getClientRects().length && !['UL', 'OL'].includes(element.tagName))
    .map(element => ({ element, line: Number(element.dataset.line) }));
  const pointAt = (line, entries, sourceMap) => {
    let previous = entries[0], next;
    for (const entry of entries) {
      if (entry.line > line) { next = entry; break; }
      previous = entry;
    }
    if (!previous) return;
    const { element } = previous;
    const block = element.tagName === 'CODE' && element.parentElement?.tagName === 'PRE' ? element.parentElement : element;
    const rect = block.getBoundingClientRect();
    // Interpolate *within* the block. The native mapping places fractional
    // source lines after the whole block, which is wrong for wrapped paragraphs
    // and long code blocks. Count code lines once per rendered version.
    if (element.tagName === 'CODE' && previous.lines === undefined) previous.lines = element.textContent.split('\n').length;
    const lines = previous.lines || Math.max(1, (next?.line ?? previous.line + 1) - previous.line);
    const progress = element.tagName !== 'CODE' && sourceMap?.line === previous.line ? sourceMap.progress : (line - previous.line) / lines;
    const ratio = Math.max(0, Math.min(1, progress));
    return { top: rect.top + ratio * rect.height, bottom: rect.bottom, height: rect.height, blockTop: rect.top };
  };
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!directive || !directive.focused || document.hasFocus()) return;
      const entries = mappings();
      const end = entries[entries.length - 1];
      if (!end) return;
      // The caret notification can precede Markdown's asynchronous render.
      // Never map new source lines through the previous document's EOF marker.
      if (directive.mode === 'caret' && end.line !== directive.lineCount) return;
      const line = directive.mode === 'caret' ? directive.line : viewportLine;
      if (!Number.isFinite(line)) return;
      const point = pointAt(line, entries, directive.mode === 'caret' ? directive.caretMap : directive.viewportMap);
      if (!point) return;
      let offset;
      if (directive.mode === 'viewport') offset = point.top;
      else {
        const top = point.height > innerHeight ? point.top : point.blockTop;
        const bottom = point.height > innerHeight ? point.top + 24 : point.bottom;
        offset = top < 8 ? top - 8 : bottom > innerHeight - 8 ? bottom - innerHeight + 8 : 0;
      }
      if (!Number.isFinite(offset) || Math.abs(offset) < 1) return;
      following = true;
      document.documentElement.style.overflowAnchor = 'none';
      window.scrollBy({ top: offset, behavior: 'instant' });
    });
  };
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'updateContent' && message.source !== source) {
      source = message.source;
      directive = undefined;
      mapped = undefined;
      previewOwnsScroll = false;
      lastIntent = undefined;
    }
    if (message.source !== source) return;
    if (message.plainMarkdownSync) {
      const info = message.plainMarkdownSync;
      if (info.editor !== undefined) {
        const intent = `${info.editor}:${info.intent}`;
        if (info.focused && intent !== lastIntent) previewOwnsScroll = false;
        lastIntent = intent;
      }
      if (!previewOwnsScroll) directive = info;
    }
    if (message.type === 'updateView' && message.plainMarkdownSync) {
      // Do not start the extension's second, delayed scroll controller.
      event.stopImmediatePropagation();
      viewportLine = message.line;
      schedule();
    } else if (message.type === 'onDidChangeTextEditorSelection') schedule();
  }, true);
  window.addEventListener('vscode.markdown.updateContent', () => { mapped = undefined; schedule(); });
  window.addEventListener('resize', schedule);
  document.addEventListener('load', event => { if (event.target?.tagName === 'IMG') schedule(); }, true);
}

function enhanceMarkdownHtml(html) {
  if (!html.includes('id="vscode-markdown-preview-data"') || html.includes('id="singularity-markdown-follow"')) return html;
  const script = /<script\b[^>]*\bnonce=("[^"]+"|'[^']+')[^>]*>/i.exec(html);
  if (!script) return html;
  // Install before the extension acquires its webview API, preserving its CSP.
  return html.slice(0, script.index) + `<script id="singularity-markdown-follow" nonce=${script[1]}>(${synchronizePreview.toString()})();</script>` + html.slice(script.index);
}

// Unequal source line lengths must not divide a wrapped paragraph into equal
// visual pieces. Monaco supplies offsets without copying the document text.
function sourceProgress(model, lines, position) {
  const line = position.lineNumber - 1;
  let low = 0, high = lines.length;
  while (low < high) { const middle = (low + high) >>> 1; if (lines[middle] <= line) low = middle + 1; else high = middle; }
  const start = lines[low - 1] ?? 0, end = lines[low] ?? model.getLineCount();
  const offset = line => line >= model.getLineCount() ? model.getValueLength() : model.getOffsetAt({ lineNumber: line + 1, column: 1 });
  const first = offset(start), length = Math.max(1, offset(end) - first);
  return { line: start, progress: Math.max(0, Math.min(1, (model.getOffsetAt(position) - first) / length)) };
}

module.exports = bind => {
  const { WebviewWidget } = require('@theia/plugin-ext/lib/main/browser/webview/webview');
  const { FrontendApplicationContribution } = require('@theia/core/lib/browser/frontend-application-contribution');
  const { EditorManager } = require('@theia/editor/lib/browser/editor-manager');
  const URI = require('@theia/core/lib/common/uri').default;
  let editors, nextEditor = 0;
  const states = new WeakMap(), maps = new WeakMap();
  bind(FrontendApplicationContribution).toDynamicValue(({ container }) => ({ onStart() { editors = container.get(EditorManager); } }));
  const preprocess = WebviewWidget.prototype.preprocessHtml;
  WebviewWidget.prototype.preprocessHtml = function (html) {
    maps.delete(this);
    return enhanceMarkdownHtml(preprocess.call(this, html));
  };
  const send = WebviewWidget.prototype.sendMessage;
  WebviewWidget.prototype.sendMessage = function (message) {
    if (['markdown.preview', 'vscode.markdown.preview.editor'].includes(this.viewType)
        && ['updateView', 'updateContent', 'onDidChangeTextEditorSelection'].includes(message?.type)) {
      message = { ...message, plainMarkdownSync: { focused: false } };
      const editor = editors?.currentEditor?.editor;
      const control = editor?.getControl?.(), model = control?.getModel(), position = control?.getPosition();
      if (model && position && message.source && new URI(message.source).toString() === editor.uri.toString()) {
        let map = maps.get(this);
        if (!map?.lines.length || map.source !== message.source || message.type === 'updateContent') {
          const html = message.type === 'updateContent' ? message.content : this.html;
          const lines = [];
          // Parse only numeric source-map tags, once per Markdown render.
          for (const tag of (html || '').matchAll(/<(\w+)\b[^>]*\bdata-line="(\d+)"[^>]*>/g)) {
            if (!['ul', 'ol'].includes(tag[1].toLowerCase()) && /\bclass="[^"]*\bcode-line\b/.test(tag[0])) lines.push(Number(tag[2]));
          }
          map = { source: message.source, lines: [...new Set(lines)].sort((a, b) => a - b) };
          maps.set(this, map);
        }
        let state = states.get(control);
        if (!state) {
          state = { mode: 'viewport', version: model.getVersionId(), editor: ++nextEditor, intent: 0 };
          states.set(control, state);
          const node = control.getDomNode();
          const scrollSource = event => {
            if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
            state.mode = event.type === 'keydown' || (event.type === 'pointerdown' && !event.target.closest?.('.scrollbar')) ? 'caret' : 'viewport';
            state.intent++;
          };
          const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
          for (const type of inputs) node.addEventListener(type, scrollSource, { capture: true, passive: true });
          control.onDidDispose(() => {
            for (const type of inputs) node.removeEventListener(type, scrollSource, true);
          });
        }
        const version = model.getVersionId(), focused = control.hasTextFocus();
        const selection = message.type === 'onDidChangeTextEditorSelection';
        if (focused && (version !== state.version || (selection && (position.lineNumber !== state.line || position.column !== state.column)))) { state.mode = 'caret'; state.intent++; }
        state.version = version;
        if (selection) { state.line = position.lineNumber; state.column = position.column; }
        const line = position.lineNumber - 1 + (position.column - 1) / model.getLineMaxColumn(position.lineNumber);
        const caretMap = sourceProgress(model, map.lines, position);
        const visibleLine = Math.max(0, Math.min(model.getLineCount() - 1, Math.floor(message.line || 0)));
        const viewportMap = message.type === 'updateView' ? sourceProgress(model, map.lines, {
          lineNumber: visibleLine + 1,
          column: Math.max(1, Math.min(model.getLineMaxColumn(visibleLine + 1), 1 + Math.round(((message.line || 0) - visibleLine) * model.getLineMaxColumn(visibleLine + 1))))
        }) : undefined;
        message = { ...message, plainMarkdownSync: { editor: state.editor, intent: state.intent, mode: state.mode, focused, line, lineCount: model.getLineCount(), caretMap, viewportMap } };
      }
    }
    return send.call(this, message);
  };
};
module.exports.enhanceMarkdownHtml = enhanceMarkdownHtml;
module.exports.synchronizePreview = synchronizePreview;
module.exports.sourceProgress = sourceProgress;
