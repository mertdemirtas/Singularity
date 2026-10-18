'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const { normalizeAppearance } = require('../extensions/plain-editor-ui/appearance-cache.cjs');

const PRINT_OPTIONS = { pageSize: 'A4', printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }, generateDocumentOutline: true, generateTaggedPDF: true };
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function pdfName(name) {
  let base = String(name || 'Document').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  const extension = base.lastIndexOf('.');
  if (extension > 0) base = base.slice(0, extension);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = '_' + base;
  return (base || 'Document').slice(0, 180) + '.pdf';
}

// Executed only inside the selected Markdown preview's content frame. Its live
// DOM retains extension rendering, local resources, and SVGs. Print colors are
// independent of the editor theme; the on-screen preview is left unchanged.
async function prepareMarkdownPrint() {
  const data = document.getElementById('vscode-markdown-preview-data');
  if (!data) throw new Error('The Markdown preview is not ready. Try exporting again.');
  const source = JSON.parse(data.dataset.settings).source;
  const style = document.createElement('style');
  style.id = 'singularity-pdf-print';
  const policy = document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content || '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  if (nonce) style.nonce = nonce;
  style.textContent = `@media print {
    html, body {
      color-scheme:light!important; color:#24292f!important; background:#fff!important;
      --vscode-editor-background:#fff!important; --vscode-editor-foreground:#24292f!important;
      --vscode-textLink-foreground:#0969da!important; --vscode-textLink-activeForeground:#0969da!important;
      --vscode-textPreformat-foreground:#24292f!important; --vscode-textPreformat-background:#f6f8fa!important;
      --vscode-textCodeBlock-background:#f6f8fa!important; --vscode-widget-border:#d0d7de!important;
      --vscode-textBlockQuote-background:#f6f8fa!important; --vscode-textBlockQuote-border:#d0d7de!important;
    }
    html, body { height:auto!important; min-height:0!important; overflow:visible!important; padding:0!important; }
    .markdown-body { color:#24292f!important; background:#fff!important; }
    h1,h2,h3,h4,h5,h6,hr,th,td,blockquote,pre { border-color:#d0d7de!important; }
    a, a:hover { color:#0969da!important; }
    blockquote { color:#57606a!important; background:#f6f8fa!important; }
    th { color:#24292f!important; background:#f6f8fa!important; }
    td { color:#24292f!important; background:#fff!important; }
    pre, code { color:#24292f!important; background:#f6f8fa!important; }
    pre code { background:transparent!important; }
    pre code [class*="hljs-"] { color:inherit!important; background:transparent!important; }
    pre code .hljs-keyword, pre code .hljs-name, pre code .hljs-tag,
    pre code .hljs-selector-tag, pre code .hljs-literal { color:#cf222e!important; }
    pre code .hljs-string, pre code .hljs-meta-string, pre code .hljs-regexp,
    pre code .hljs-template-tag, pre code .hljs-template-variable { color:#0a3069!important; }
    pre code .hljs-comment, pre code .hljs-quote, pre code .hljs-doctag { color:#57606a!important; }
    pre code .hljs-number, pre code .hljs-built_in, pre code .hljs-builtin-name,
    pre code .hljs-type, pre code .hljs-attr, pre code .hljs-attribute,
    pre code .hljs-variable, pre code .hljs-symbol, pre code .hljs-bullet,
    pre code .hljs-link, pre code .hljs-meta, pre code .hljs-meta-keyword { color:#0550ae!important; }
    pre code .hljs-title, pre code .hljs-section { color:#8250df!important; }
    pre code .hljs-addition { color:#116329!important; background:#dafbe1!important; }
    pre code .hljs-deletion { color:#82071e!important; background:#ffebe9!important; }
    body.scrollBeyondLastLine { margin-bottom:0!important; }
    #code-csp-warning, .code-line::before { display:none!important; }
    h1,h2,h3,h4,h5,h6 { break-after:avoid-page; }
    img,svg { max-width:100%!important; max-height:245mm; object-fit:contain; break-inside:avoid; }
    pre, pre code, pre code > div { white-space:pre-wrap!important; overflow:visible!important; overflow-wrap:anywhere; }
    table { max-width:100%; } thead { display:table-header-group; } tr { break-inside:avoid; }
  }`;
  document.head.append(style);
  const images = [...document.images];
  window.singularityPdfImages = images.map(image => [image, image.getAttribute('loading')]);
  for (const image of images) image.loading = 'eager';
  let timer;
  try {
    await Promise.race([
      Promise.all([document.fonts.ready, ...images.map(image => image.decode().catch(() => {}))]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Images or fonts are still loading. Try exporting again.')), 30000); })
    ]);
  } finally { clearTimeout(timer); }
  return source;
}

function cleanupMarkdownPrint() {
  document.getElementById('singularity-pdf-print')?.remove();
  for (const [image, loading] of window.singularityPdfImages || []) {
    if (loading === null) image.removeAttribute('loading'); else image.setAttribute('loading', loading);
  }
  delete window.singularityPdfImages;
}

async function markdownFrame(contents, id) {
  if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid Markdown preview.');
  const deadline = Date.now() + 30000;
  do {
    if (contents.isDestroyed?.()) throw new Error('The preview was closed.');
    const outer = contents.mainFrame.frames.find(frame => {
      try { return new URL(frame.url).searchParams.get('id') === id; } catch { return false; }
    });
    for (const frame of outer?.frames || []) {
      if (await frame.executeJavaScript('window.frameElement?.id === "active-frame" && !!document.getElementById("vscode-markdown-preview-data")')) return frame;
    }
    // A new preview resolves its command before its inner document is attached.
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('The Markdown preview is not ready. Try exporting again.');
}

function localPath(uri) {
  try { return fileURLToPath(uri); } catch { return undefined; }
}

async function exportFolder(win, dialog, folders, source) {
  if (!Array.isArray(folders) || folders.some(folder => typeof folder !== 'string')) throw new Error('Invalid project folders.');
  const paths = folders.map(localPath).filter(Boolean);
  const file = localPath(source);
  const matching = file && paths.filter(folder => { const relative = path.relative(folder, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); });
  const folder = matching?.sort((a, b) => b.length - a.length)[0] || paths[0];
  if (folder) {
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('The project folder is unavailable.');
    return folder;
  }
  const result = await dialog.showOpenDialog(win, { title: 'Choose a folder for the PDF', buttonLabel: 'Export here', properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? undefined : result.filePaths[0];
}

async function savePdf(win, dialog, target, bytes) {
  let replace = false;
  try { await fs.access(target); replace = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (replace) {
    const choice = await dialog.showMessageBox(win, { type: 'warning', title: 'Replace PDF?', message: `${path.basename(target)} already exists.`, detail: 'Replace it with this export?', buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
    if (choice.response !== 0) return { canceled: true };
  }
  const temporary = path.join(path.dirname(target), `.singularity-pdf-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    if (replace) await fs.rename(temporary, target);
    else await fs.copyFile(temporary, target, constants.COPYFILE_EXCL);
  } finally { await fs.rm(temporary, { force: true }); }
  return { path: target };
}

function createPdfExporter({ getWindow, dialog, BrowserWindow }) {
  let busy = false;
  return async (event, request) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('PDF export access denied.');
    if (!request || !['markdown', 'text'].includes(request.kind)) throw new Error('Invalid PDF export.');
    if (busy) throw new Error('A PDF export is already in progress.');
    busy = true;
    let frame, printWindow, temporary;
    let closed = false;
    const cancelOnClose = () => {
      closed = true;
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    };
    win.once?.('closed', cancelOnClose);
    try {
      let source = request.source;
      if (request.kind === 'markdown') {
        frame = await markdownFrame(win.webContents, request.id);
        source = await frame.executeJavaScript(`(${prepareMarkdownPrint.toString()})()`);
      } else if (typeof request.text !== 'string' || Buffer.byteLength(request.text, 'utf8') > 20 * 1024 * 1024) {
        throw new Error('Text PDF export supports files up to 20 MB.');
      }
      const folder = await exportFolder(win, dialog, request.folders, source);
      if (!folder) return { canceled: true };
      const name = source ? decodeURIComponent(new URL(source).pathname.split('/').pop()) : request.name;
      let target = path.join(folder, pdfName(name));
      // A PDF forced open as plain text must never replace its own source.
      if (localPath(source)?.toLowerCase() === target.toLowerCase()) target = target.slice(0, -4) + '-export.pdf';
      if (closed) throw new Error('PDF export canceled because the editor was closed.');
      let bytes;
      if (frame) bytes = await frame.printToPDF(PRINT_OPTIONS);
      else {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-pdf-'));
        const family = normalizeAppearance({ background: '#fff', foreground: '#222', fontFamily: request.fontFamily }).fontFamily;
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(name || 'Document')}</title><style>html{color-scheme:light;color:#222;background:white}body{margin:0;font:11pt/1.45 ${family}}h1{font:600 16pt/1.4 sans-serif;overflow-wrap:anywhere;break-after:avoid-page}pre{white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}</style></head><body><h1>${escapeHtml(name || 'Document')}</h1><pre>${escapeHtml(request.text)}</pre></body></html>`;
        const filename = path.join(temporary, 'document.html'); await fs.writeFile(filename, html);
        printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
        printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        await printWindow.loadFile(filename);
        bytes = await printWindow.webContents.printToPDF(PRINT_OPTIONS);
      }
      if (closed) throw new Error('PDF export canceled because the editor was closed.');
      return await savePdf(win, dialog, target, bytes);
    } finally {
      try {
        if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
        if (temporary) await fs.rm(temporary, { recursive: true, force: true });
        if (frame && !frame.isDestroyed()) await frame.executeJavaScript(`(${cleanupMarkdownPrint.toString()})()`).catch(error => console.warn('Singularity: could not reset PDF preview styling', error));
      } finally { win.removeListener?.('closed', cancelOnClose); busy = false; }
    }
  };
}

module.exports = { createPdfExporter, pdfName, markdownFrame, savePdf };
