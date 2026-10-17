'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { filePage } = require('./git-file-page.cjs');
const PAGE = 100;

async function gitRead(repository, executable, args, maxBuffer = 8 * 1024 * 1024, encoding = 'utf8') {
  const { stdout } = await execute(executable, ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], {
    cwd: repository.rootUri.fsPath, encoding, maxBuffer, timeout: 15000,
    windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' }
  });
  return stdout;
}

async function commitDetails(repository, executable, request) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(request?.commit || '')) throw new Error('Select a valid commit.');
  const commit = await repository.getCommit(request.commit);
  const args = ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z'];
  if (commit.parents.length) args.push(commit.parents[0]); else args.push('--root');
  args.push(commit.hash, '--');
  const fields = (await gitRead(repository, executable, args)).split('\0');
  const files = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    if (fields[index] && fields[index + 1]) files.push({ status: fields[index], path: fields[index + 1] });
  }
  const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
  return { id: commit.hash, parents: commit.parents, message: commit.message, author: commit.authorName,
    date: commit.authorDate?.toISOString(), files: files.slice(offset, offset + PAGE), total: files.length,
    nextOffset: offset + PAGE < files.length ? offset + PAGE : undefined };
}

async function commitPreview(repository, executable, request) {
  // Resolve the file from the commit itself; never accept an arbitrary path or ref.
  const details = await commitDetails(repository, executable, { commit: request.commit, offset: request.offset });
  const file = details.files.find(item => item.path === request.path);
  if (!file) throw new Error('This file is not in the selected commit page. Select it again.');
  for (const ref of [details.parents[0], details.id].filter(Boolean)) {
    try {
      if ((await repository.getObjectDetails(ref, file.path)).size > 1024 * 1024) return { note: 'Large file. The inline preview is limited to files up to 1 MB.' };
    } catch (error) { if (error.gitErrorCode !== 'UnknownPath') throw error; }
  }
  if (request.fullFile) {
    const before = file.status === 'D';
    const ref = before ? details.parents[0] : details.id;
    const content = await gitRead(repository, executable, ['show', `${ref}:${file.path}`], 1024 * 1024, null);
    return filePage(content, request, before ? 'before' : 'after');
  }
  const args = details.parents.length ? ['diff', details.parents[0], details.id]
    : ['show', '--format=', '--root', details.id];
  args.push('--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--unified=3', '--', file.path);
  let text;
  try { text = await gitRead(repository, executable, args, 256 * 1024); }
  catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { note: 'This diff is too large for the compact preview. Expand the whole file to review it.', canExpand: true };
    throw error;
  }
  const clipped = text.slice(0, 64000).split('\n').slice(0, 600).join('\n');
  return { note: (details.parents.length > 1 ? 'Merge commit compared with its first parent.' : details.parents.length ? 'Changes introduced by this commit.' : 'Files added by the first commit.')
    + (clipped.length < text.length ? ' Preview shortened.' : ''), text: clipped, canExpand: true };
}

async function branchGraph(repository, executable, request = {}) {
  if (!repository.state.HEAD?.commit) return { commits: [], hasMore: false };
  const count = Number(request.limit);
  const limit = Math.min(1000, Math.max(100, Number.isFinite(count) ? Math.floor(count) : 100));
  const [log, references] = await Promise.all([
    gitRead(repository, executable, ['log', '--branches', '--remotes', 'HEAD', '--topo-order', `--max-count=${limit + 1}`, '--format=%H%x00%P%x00%s%x00%an%x00%aI', '-z']),
    gitRead(repository, executable, ['for-each-ref', '--format=%(objectname)%00%(refname:short)%00%(refname)', 'refs/heads', 'refs/remotes'])
  ]);
  const refs = new Map();
  for (const line of references.split('\n').filter(Boolean)) {
    const [id, name, fullName] = line.split('\0');
    if (!refs.has(id)) refs.set(id, []);
    refs.get(id).push({ name, remote: fullName.startsWith('refs/remotes/'), current: fullName === `refs/heads/${repository.state.HEAD.name}` });
  }
  const fields = log.split('\0'), commits = [];
  for (let index = 0; index + 4 < fields.length; index += 5) {
    const [id, parents, message, author, date] = fields.slice(index, index + 5);
    if (id) commits.push({ id, parents: parents ? parents.split(' ') : [], message, author, date, refs: refs.get(id) || [] });
  }
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit, limit };
}

module.exports = { commitDetails, commitPreview, gitRead, branchGraph };
