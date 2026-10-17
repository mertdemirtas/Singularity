'use strict';

const MAX_FILE = 1024 * 1024;
const PAGE_LINES = 200;

function filePage(content, request = {}, side = 'after') {
  if (content.length > MAX_FILE) return { note: 'Whole-file previews are limited to files up to 1 MB.' };
  if (content.includes(0)) return { note: 'This is a binary file. A text preview is not available.' };
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
  catch { return { note: 'This file is not UTF-8 text.' }; }
  let totalLines = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) totalLines++;
  const requested = Number(request.lineOffset);
  const startLine = Math.min(Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0), Math.max(0, totalLines - 1));
  const rows = []; let start = 0, number = 0;
  while (number < startLine) { start = text.indexOf('\n', start) + 1; number++; }
  while (number < Math.min(totalLines, startLine + PAGE_LINES)) {
    const end = text.indexOf('\n', start);
    rows.push({ text: text.slice(start, end === -1 ? text.length : end).replace(/\r$/, ''), kind: 'context', [side === 'before' ? 'oldLine' : 'newLine']: number + 1 });
    number++; start = end === -1 ? text.length : end + 1;
  }
  return { fullFile: true, side, rows, totalLines, startLine,
    previousLine: startLine ? Math.max(0, startLine - PAGE_LINES) : undefined,
    nextLine: number < totalLines ? number : undefined,
    note: side === 'before' ? 'Whole file before deletion.' : 'Whole file, including unchanged lines.' };
}

module.exports = { filePage, MAX_FILE };
