'use strict';

function parsePatch(input) {
  let oldLine = 0, newLine = 0, hunk = false, added = 0, removed = 0;
  const rows = [], metadata = [];
  for (const text of input.split('\n')) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (match) { oldLine = Number(match[1]); newLine = Number(match[2]); hunk = true; rows.push({ text, kind: 'hunk' }); continue; }
    if (text.startsWith('diff --git ')) hunk = false;
    if (!hunk || text.startsWith('\\') || !text) { if (text) metadata.push(text); continue; }
    if (text[0] === '+') { added++; rows.push({ text, kind: 'added', newLine: newLine++ }); }
    else if (text[0] === '-') { removed++; rows.push({ text, kind: 'removed', oldLine: oldLine++ }); }
    else if (text[0] === ' ') rows.push({ text, kind: 'context', oldLine: oldLine++, newLine: newLine++ });
    else metadata.push(text);
  }
  return { rows, metadata, added, removed };
}

module.exports = { parsePatch };
