'use strict';

// Work on UTF-16 offsets, matching Monaco's model offsets. Keep the original
// line endings and every byte of text outside the chosen conflict block.
function parseMergeBlocks(text) {
  const markers = /^\uFEFF?([<>=|])\1{6,}[^\r\n]*(?:\r?\n|$)/gm;
  const blocks = []; let open, malformed = false, match;
  while ((match = markers.exec(text))) {
    const bom = match[0].startsWith('\uFEFF') ? 1 : 0;
    if(bom && match.index !== 0)continue;
    const line = match[0].slice(bom).replace(/\r?\n$/, '');
    const run = /^([<>=|])\1*/.exec(line)[0], kind = run[0], suffix = line.slice(run.length);
    if (kind === '=' ? suffix !== '' : suffix && !/^[ \t]/.test(suffix)) continue;
    if (kind === '<') {
      if (open) { malformed = true; continue; }
      open = {start:match.index+bom,currentStart:markers.lastIndex,width:run.length};
    } else if (!open) {
      if (kind !== '=') malformed = true;
    } else if (run.length !== open.width) malformed = true;
    else if (kind === '|') {
      if (open.baseStart !== undefined || open.incomingStart !== undefined) malformed = true;
      else { open.currentEnd = match.index; open.baseStart = markers.lastIndex; }
    } else if (kind === '=') {
      if (open.incomingStart !== undefined) malformed = true;
      else { open.currentEnd ??= match.index; open.incomingStart = markers.lastIndex; open.separator = match.index; }
    } else {
      if (open.incomingStart === undefined) malformed = true;
      else blocks.push({...open,end:markers.lastIndex,incomingEnd:match.index,
        current:text.slice(open.currentStart,open.currentEnd), incoming:text.slice(open.incomingStart,match.index)});
      open = undefined;
    }
  }
  return {blocks,malformed:malformed || !!open};
}

function resolveBlock(text, block, choice, selected) {
  // Revalidate offsets against the latest model so a stale toolbar cannot
  // replace unrelated text after manual edits or an Undo.
  const parsed = parseMergeBlocks(text);
  const current = parsed.blocks.find(item=>item.start === block?.start && item.end === block?.end);
  if (parsed.malformed || !current) throw new Error('This conflict changed. Select it again before applying a choice.');
  let replacement;
  if (choice === 'current') replacement = current.current;
  else if (choice === 'incoming') replacement = current.incoming;
  else if (choice === 'both') replacement = current.current + current.incoming;
  else if (choice === 'selection' && typeof selected === 'string' && selected.length) {
    replacement = selected;
    if ((current.end < text.length || text.endsWith('\n')) && !replacement.endsWith('\n')) replacement += text.includes('\r\n') ? '\r\n' : '\n';
  } else throw new Error('Select a version or select source lines to use.');
  return {start:current.start,end:current.end,text:replacement};
}

module.exports = {parseMergeBlocks,resolveBlock};
