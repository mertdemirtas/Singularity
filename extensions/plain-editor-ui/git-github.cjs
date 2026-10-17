'use strict';

const { randomUUID } = require('node:crypto');
const SCOPES = ['repo', 'workflow', 'user:email', 'read:user'];

function validBranch(name) {
  return typeof name === 'string' && name.length <= 240 && name !== 'HEAD' && name !== '@' && !!name
    && !name.startsWith('-') && !/[\x00-\x20\x7f~^:?*\[\\]/.test(name) && !name.includes('..') && !name.includes('@{')
    && name.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
}
function validateCreate(input) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(input?.owner || '')) throw new Error('Enter a GitHub account or organization name.');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(input.name || '') || /^\.+$/.test(input.name)) throw new Error('Use a repository name with letters, numbers, dots, underscores or hyphens (up to 100 characters).');
  if (!['private','public'].includes(input.visibility)) throw new Error('Choose public or private visibility.');
  if (!['publish','github'].includes(input.mode)) throw new Error('Choose whether to publish this project or create a repository on GitHub only.');
  if (!validBranch(input.defaultBranch)) throw new Error('Enter a valid default branch name.');
  if (typeof input.description !== 'string' || input.description.length > 350) throw new Error('Keep the description under 350 characters.');
  if (input.mode === 'publish' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.remoteName || '')) throw new Error('Use a remote name with letters, numbers, dots, underscores or hyphens.');
  for (const key of ['issues','wiki','discussions','mergeCommit','squashMerge','rebaseMerge','deleteBranch','template']) {
    if (typeof input[key] !== 'boolean') throw new Error('Select the repository options before creating it.');
  }
  if (!input.mergeCommit && !input.squashMerge && !input.rebaseMerge) throw new Error('Allow at least one pull request merge method.');
  for (const key of ['gitignore','license']) if (input[key] && !/^[A-Za-z0-9_.+-]{1,100}$/.test(input[key])) throw new Error(`Choose a valid ${key} template.`);
  return input;
}

// This service runs in the extension host. OAuth tokens never cross the UI RPC
// boundary, enter Git URLs, or get stored in repository settings.
function createGitHubService(api, { fetch: fetchRequest = globalThis.fetch } = {}) {
  const receipts = new Map(), pending = new Set();
  async function session() {
    await api.extensions.getExtension('vscode.github-authentication')?.activate();
    const value = await api.authentication.getSession('github', SCOPES, { createIfNone: true });
    if (!value?.accessToken) throw new Error('GitHub sign-in was cancelled.');
    return value;
  }
  async function request(token, method, path, body) {
    let response;
    try {
      response = await fetchRequest(`https://api.github.com${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'Singularity',
          'X-GitHub-Api-Version': '2026-03-10', ...(body ? {'Content-Type':'application/json'} : {}) },
        ...(body ? {body:JSON.stringify(body)} : {})
      });
    } catch { throw new Error('GitHub could not be reached. If creation had started, check GitHub before trying to create it again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = response.status === 401 ? 'Sign in to GitHub again.' : response.status === 403 ? 'GitHub denied this action. Check account permissions, organization policy, or rate limits.'
        : response.status === 422 ? 'GitHub rejected these settings. The repository name may already exist, or an option may be unavailable for this account.'
        : 'GitHub could not complete this action.';
      const explanation = [data.message,...(Array.isArray(data.errors)?data.errors.map(item=>typeof item==='string'?item:[item.field,item.message || item.code].filter(Boolean).join(': ')):[])].filter(Boolean).join(' ').split(token).join('[redacted]').slice(0,500);
      throw new Error(`${detail} (HTTP ${response.status})${explanation?' '+explanation:''}`);
    }
    return data;
  }
  function source(repository) {
    const head = repository?.state.HEAD;
    return repository && { branch:head?.name, commit:head?.commit, remoteNames:repository.state.remotes.map(remote=>remote.name) };
  }
  function assertSource(repository, input, checkRemote = true) {
    if (!repository || !input.sourceBranch || !input.sourceCommit) throw new Error('Make a commit on a local branch before publishing this project.');
    const state = repository.state;
    if (state.HEAD?.name !== input.sourceBranch || state.HEAD.commit !== input.sourceCommit) throw new Error('The local branch changed. Open the creation form again to review what will be published.');
    if (state.mergeChanges?.length) throw new Error('Resolve conflicts before publishing.');
    if (checkRemote && state.remotes.some(remote=>remote.name === input.remoteName)) throw new Error('That remote name already exists. Choose a new remote name.');
  }
  async function setup(repository) {
    const {accessToken} = await session();
    const [account, ignores, licenses] = await Promise.all([
      request(accessToken,'GET','/user'),
      request(accessToken,'GET','/gitignore/templates').catch(error=>({error:error.message})),
      request(accessToken,'GET','/licenses?per_page=100').catch(error=>({error:error.message}))
    ]);
    return {login:account.login, source:source(repository), gitignores:Array.isArray(ignores)?ignores:[],
      licenses:Array.isArray(licenses)?licenses.map(item=>({key:item.key,name:item.name})):[],
      warning:[ignores.error,licenses.error].filter(Boolean).join(' ')};
  }
  function summary(receipt) {
    return {created:true,receipt:receipt.id,url:receipt.url,cloneUrl:receipt.cloneUrl,owner:receipt.owner,name:receipt.name,
      defaultBranch:receipt.defaultBranch,visibility:receipt.visibility,remoteName:receipt.remoteName,published:!!receipt.pushed};
  }
  async function finish(repository, receipt, token) {
    const base = `/repos/${encodeURIComponent(receipt.owner)}/${encodeURIComponent(receipt.name)}`;
    try {
      if (receipt.mode === 'publish') {
        if (!repository || repository.rootUri.toString() !== receipt.root) throw new Error('Reopen the original local repository to finish publishing.');
        await repository.status();
        if (!receipt.pushed) assertSource(repository,receipt,false);
        if (!receipt.connected) {
          const existing = repository.state.remotes.find(remote=>remote.name === receipt.remoteName);
          if (existing && (existing.pushUrl || existing.fetchUrl) !== receipt.cloneUrl) throw new Error('The remote name is now in use by another repository. Rename that local remote before retrying.');
          if (!existing) await repository.addRemote(receipt.remoteName, receipt.cloneUrl);
          receipt.connected = true;
        }
        if (!receipt.pushed) {
          await repository.push(receipt.remoteName, `${receipt.sourceBranch}:refs/heads/${receipt.defaultBranch}`, true);
          receipt.pushed = true;
        }
      } else if (!receipt.renamed && receipt.originalBranch !== receipt.defaultBranch) {
        await request(token,'POST',`${base}/branches/${encodeURIComponent(receipt.originalBranch)}/rename`,{new_name:receipt.defaultBranch});
        receipt.renamed = true;
      }
      await request(token,'PATCH',base,{default_branch:receipt.defaultBranch,...receipt.settings});
      return {...summary(receipt),complete:true,message:`Created ${receipt.owner}/${receipt.name}${receipt.pushed?' and published the selected branch':''}.`};
    } catch (error) {
      return {...summary(receipt),complete:false,message:`The GitHub repository was created, but setup is incomplete. ${String(error.stderr || error.message).split(token).join('[redacted]').slice(0,1500)}`};
    }
  }
  async function run(repository, action, input = {}) {
    if (api.workspace.isTrusted === false) throw new Error('Trust this workspace before creating or publishing a GitHub repository.');
    if (action === 'setup') return setup(repository);
    if (!['create','finish'].includes(action)) throw new Error('Unknown GitHub action.');
    if (action === 'create') validateCreate(input);
    const previous = action === 'finish' && receipts.get(input.receipt);
    if (action === 'finish' && !previous) throw new Error('This publishing session is no longer available. The repository remains on GitHub; connect it from Remotes to continue.');
    const key = `${previous ? previous.owner : input.owner}/${previous ? previous.name : input.name}`.toLowerCase();
    if (pending.has(key)) throw new Error('This repository operation is already running.');
    pending.add(key);
    try {
      if (input.mode === 'publish') { await repository?.status(); assertSource(repository,input); }
      const {accessToken} = await session();
      if (previous) return await finish(repository,previous,accessToken);
      if (input.mode === 'publish') { await repository.status(); assertSource(repository,input); }
      const account = await request(accessToken,'GET','/user');
      const settings = {has_issues:input.issues,has_wiki:input.wiki,has_discussions:input.discussions,is_template:input.template,
        allow_merge_commit:input.mergeCommit,allow_squash_merge:input.squashMerge,allow_rebase_merge:input.rebaseMerge,delete_branch_on_merge:input.deleteBranch};
      const endpoint = account.login.toLowerCase() === input.owner.toLowerCase() ? '/user/repos' : `/orgs/${encodeURIComponent(input.owner)}/repos`;
      const created = await request(accessToken,'POST',endpoint,{name:input.name,description:input.description,private:input.visibility==='private',auto_init:input.mode==='github',
        ...(input.mode==='github' && input.gitignore?{gitignore_template:input.gitignore}:{}),...(input.mode==='github' && input.license?{license_template:input.license}:{})});
      const receipt = {...input,id:randomUUID(),root:repository?.rootUri.toString(),settings,originalBranch:created.default_branch,
        url:`https://github.com/${input.owner}/${input.name}`,cloneUrl:`https://github.com/${input.owner}/${input.name}.git`};
      receipts.set(receipt.id,receipt);
      return await finish(repository,receipt,accessToken);
    } finally { pending.delete(key); }
  }
  return {run};
}

module.exports = {createGitHubService,validateCreate,validBranch};
