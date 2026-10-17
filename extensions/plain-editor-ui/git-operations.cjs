'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function mergeState(root) {
  let directory = path.join(root, '.git');
  try {
    if ((await fs.stat(directory)).isFile()) {
      const pointer = await fs.readFile(directory, 'utf8');
      const match = /^gitdir: (.+)\r?$/m.exec(pointer);
      if (!match) throw new Error('Cannot read the repository Git directory.');
      directory = path.resolve(root, match[1].replace(/\r$/, ''));
    }
    await fs.access(path.join(directory, 'MERGE_HEAD'));
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function runGitOperation(repository, operation, request = {}, ensureIdentity) {
  await repository.status();
  const state = repository.state;
  const merging = await mergeState(repository.rootUri.fsPath);
  if (operation === 'merge') {
    if (!state.HEAD?.name || !state.HEAD.commit) throw new Error('Check out a branch with a commit before merging.');
    if (merging || state.mergeChanges.length) throw new Error('Finish or abort the current merge first.');
    if (state.HEAD.name !== request.target || state.HEAD.commit !== request.targetCommit) throw new Error('The current branch changed. Review the merge again.');
    if (state.indexChanges.length || state.workingTreeChanges.length) throw new Error('Commit or stash your changes before merging.');
    const branch = await repository.getBranch(request.source);
    if (!branch?.commit || branch.name === state.HEAD.name) throw new Error('Choose another branch to merge.');
    if (request.sourceCommit !== branch.commit) throw new Error('The source branch changed. Review the merge again.');
    if (!await ensureIdentity(repository)) return { message: 'Merge cancelled.' };
    const before = state.HEAD.commit;
    try { await repository.merge(branch.name); }
    catch (error) {
      await repository.status();
      if (repository.state.mergeChanges.length) return { conflicts: repository.state.mergeChanges.length,
        message: `Merge paused: ${repository.state.mergeChanges.length} conflicted file(s). Resolve them below, then finish the merge.` };
      throw error;
    }
    await repository.status();
    return { message: repository.state.HEAD.commit === before ? `${request.target} already contains ${branch.name}.`
      : `Merged ${branch.name} into ${request.target}.` };
  }
  if (operation === 'abortMerge') {
    if (!merging) throw new Error('There is no merge to abort.');
    await repository.mergeAbort(); await repository.status();
    return { message: 'Merge aborted. The branch is back to its previous state.' };
  }
  if (operation === 'commit') {
    if (state.mergeChanges.length) throw new Error('Resolve and stage every conflicted file before committing.');
    if (!state.indexChanges.length && !merging) throw new Error('Stage the changes you want to commit first.');
    if (!request.message?.trim()) throw new Error('Enter a commit message.');
    if (!await ensureIdentity(repository)) return { message: 'Commit cancelled.' };
    await repository.commit(request.message, { all: false }); await repository.status();
    return { message: merging ? 'Merge completed and committed.' : 'Changes committed.' };
  }
  throw new Error('Unknown Git operation.');
}

module.exports = { mergeState, runGitOperation };
