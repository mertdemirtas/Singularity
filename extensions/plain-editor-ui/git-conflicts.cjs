'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { gitRead } = require('./git-history.cjs');
const MAX_FILE = 1024 * 1024;
const {parseMergeBlocks} = require('./git-merge-blocks.cjs');

async function conflictDetails(repository, api, executable, request) {
  const change = repository.state.mergeChanges.find(item => item.uri.toString() === request?.uri);
  if (!change) throw new Error('This conflict changed. Refresh and select it again.');
  const relative = path.relative(repository.rootUri.fsPath, change.uri.fsPath).split(path.sep).join('/');
  const entries = await gitRead(repository, executable, ['ls-files', '-u', '-z', '--', relative]);
  const stages = entries.split('\0').filter(Boolean).map(entry => /^(\d+) ([a-f0-9]+) ([123])\t/.exec(entry));
  if (stages.some(entry => !entry || entry[1] !== '100644' && entry[1] !== '100755')) throw new Error('This is not a regular text-file conflict. Resolve it with a Git tool that supports this file type.');
  const decode = content => {
    if (content.length > MAX_FILE || content.includes(0)) throw new Error('Inline conflict editing supports UTF-8 text files up to 1 MB.');
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
    catch { throw new Error('This file is not UTF-8 text.'); }
  };
  let content = Buffer.alloc(0), exists = false;
  try {
    if ((await api.workspace.fs.stat(change.uri)).size > MAX_FILE) throw new Error('This file is too large for inline conflict editing (1 MB limit).');
    content = Buffer.from(await api.workspace.fs.readFile(change.uri)); exists = true;
  } catch (error) { if (!['FileNotFound', 'ENOENT'].includes(error.code)) throw error; }
  const readStage = async stage => {
    const entry = stages.find(item => item[3] === stage);
    if (!entry) return { deleted: true, text: '' };
    const size = Number((await gitRead(repository, executable, ['cat-file', '-s', entry[2]])).trim());
    if (size > MAX_FILE) throw new Error('This file is too large for inline conflict editing (1 MB limit).');
    return { deleted: false, text: decode(await gitRead(repository, executable, ['cat-file', 'blob', entry[2]], MAX_FILE, null)) };
  };
  const [current, incoming] = await Promise.all([readStage('2'), readStage('3')]);
  return { uri: change.uri.toString(), current, incoming, result: decode(content), deleted: !exists,
    stamp: createHash('sha256').update(repository.state.HEAD?.commit || '').update(entries).update(exists ? 'exists' : 'deleted').update(content).digest('hex') };
}

async function resolveConflict(repository, api, executable, request) {
  await repository.status();
  const details = await conflictDetails(repository, api, executable, request);
  if (details.stamp !== request.stamp) throw new Error('The file changed after you opened it. Reload the conflict before saving.');
  if (typeof request.result !== 'string' || Buffer.byteLength(request.result) > MAX_FILE) throw new Error('The resolution must be text smaller than 1 MB.');
  const parsed = parseMergeBlocks(request.result);
  if (!request.deleted && (parsed.blocks.length || parsed.malformed)) throw new Error('Resolve the remaining conflict blocks before saving the result.');
  const change = repository.state.mergeChanges.find(item => item.uri.toString() === details.uri);
  if (request.deleted) {
    try { await api.workspace.fs.delete(change.uri); }
    catch (error) { if (!['FileNotFound', 'ENOENT'].includes(error.code)) throw error; }
  } else await api.workspace.fs.writeFile(change.uri, Buffer.from(request.result));
  try { await repository.add([change.uri.fsPath]); }
  catch (error) { throw new Error(`The result was saved but could not be staged: ${error.message}`); }
  await repository.status();
  return { message: 'Resolution saved and staged. Resolve any remaining files, then finish the merge.' };
}

module.exports = { conflictDetails, resolveConflict };
