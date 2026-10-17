'use strict';

const MAX_FILE = 1024 * 1024;
const MAX_TEXT = 64000;
const MAX_LINES = 600;
const { filePage } = require('./git-file-page.cjs');

async function gitPreview(repository, api, request) {
  const state = repository.state;
  const changes = request?.staged ? state.indexChanges : [...state.workingTreeChanges, ...state.untrackedChanges];
  const change = changes.find(item => item.uri.toString() === request?.uri);
  if (!change) return { note: 'This file changed. Refresh and select it again.' };
  const path = change.uri.fsPath;
  const objectSize = async (ref, file) => {
    try { return (await repository.getObjectDetails(ref, file)).size; }
    catch (error) { if (error.gitErrorCode === 'UnknownPath') return undefined; throw error; }
  };
  let size = 0;
  let deleted = false;
  if (request.staged) size = await objectSize('', path);
  else {
    try { size = (await api.workspace.fs.stat(change.uri)).size; }
    catch (error) { if (!['FileNotFound', 'ENOENT'].includes(error.code)) throw error; deleted = true; }
  }
  if (size > MAX_FILE) return { note: 'Inline previews are limited to files up to 1 MB.' };
  const untracked = !request.staged && state.untrackedChanges.includes(change);
  const originalSize = untracked || (request.staged && !state.HEAD?.commit) ? 0
    : await objectSize(request.staged ? 'HEAD' : '', change.originalUri?.fsPath || path);
  if (originalSize > MAX_FILE) return { note: 'Inline previews are limited to files up to 1 MB.' };
  if (request.fullFile) {
    const before = request.staged ? size === undefined : deleted;
    const content = request.staged ? await repository.buffer(before ? 'HEAD' : '', path)
      : before ? await repository.buffer('', path) : await api.workspace.fs.readFile(change.uri);
    return filePage(content, request, before ? 'before' : 'after');
  }
  let text, note;
  if (untracked) {
    const content = await api.workspace.fs.readFile(change.uri);
    if (content.length > MAX_FILE) return { note: 'Inline previews are limited to files up to 1 MB.' };
    if (content.includes(0)) return { note: 'Binary file. A text diff is not available.' };
    text = Buffer.from(content).toString('utf8'); note = 'New file. Stage it to include it in your commit.';
  } else if (request.staged) {
    text = await repository.diffIndexWithHEAD(path); note = 'Staged changes compared with the latest commit.';
  } else {
    text = await repository.diffWithHEAD(path); note = 'Unstaged changes compared with the staged version.';
  }
  if (!text) return { note: 'No text diff is available for this file.' };
  const clipped = text.slice(0, MAX_TEXT).split('\n').slice(0, MAX_LINES).join('\n');
  if (clipped.length < text.length) note += ' Preview shortened to keep the workspace responsive.';
  return { note, text: clipped, canExpand: true, plainText: untracked };
}

module.exports = { gitPreview };
