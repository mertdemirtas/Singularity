'use strict';

const {parseMergeBlocks}=require('./git-merge-blocks.cjs');

// Locate each conflict in the read-only full file. Context disambiguates repeated
// snippets; an ambiguous match stays unavailable rather than editing a wrong copy.
function locateConflictSources(merge, source, side) {
  const eol=source.includes('\r\n')?'\r\n':'\n';
  merge=merge.replace(/\r?\n/g,eol);
  const blocks=parseMergeBlocks(merge).blocks;
  // A projection also locates repeated/empty regions when this version exactly
  // matches the source. No text search or guessed occurrence is needed.
  const parts=[],projected=[];let cursor=0,length=0;
  for(const block of blocks) {
    const context=merge.slice(cursor,block.start);parts.push(context,block[side]);length+=context.length;
    projected.push({start:length,end:length+block[side].length});length+=block[side].length;cursor=block.end;
  }
  parts.push(merge.slice(cursor));const version=parts.join('');
  if(version===source)return projected;
  if(version.endsWith(eol)&&version.slice(0,-eol.length)===source)return projected.map(range=>({start:Math.min(range.start,source.length),end:Math.min(range.end,source.length)}));
  return blocks.map((block,index)=> {
    const text=block[side];
    const before=merge.slice(Math.max(blocks[index-1]?.end || 0,block.start-512),block.start).split(eol).slice(-4).join(eol);
    const after=merge.slice(block.end,Math.min(blocks[index+1]?.start ?? merge.length,block.end+512)).split(eol).slice(0,3).join(eol);
    for(const [prefix,suffix] of [[before,after],[before,''],['',after],['','']]) {
      const pattern=prefix+text+suffix;if(!pattern)continue;
      const start=source.indexOf(pattern);
      if(start!==-1&&source.indexOf(pattern,start+1)===-1)return {start:start+prefix.length,end:start+prefix.length+text.length};
    }
    return null;
  });
}

// Keep neighboring regions separate, including adjacent empty resolutions.
function moveConflictRanges(ranges, target, start, end, length) {
  const delta=length-(end-start);
  return ranges.map((range,index)=> {
    if(index===target)return {start,end:start+length};
    if(!range)return null;
    if(range.end<=start && !(start===end&&range.start===start&&index>target))return range;
    if(range.start>=end)return {start:range.start+delta,end:range.end+delta};
    return null;
  });
}

module.exports={locateConflictSources,moveConflictRanges};
