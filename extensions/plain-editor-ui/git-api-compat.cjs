'use strict';

const { gitPreview } = require('./git-preview.cjs');
const { mergeState, runGitOperation } = require('./git-operations.cjs');
const { commitDetails, commitPreview, branchGraph } = require('./git-history.cjs');
const { conflictDetails, resolveConflict } = require('./git-conflicts.cjs');
const { createGitHubService } = require('./git-github.cjs');
const { startupSnapshot } = require('./git-startup.cjs');

const COMMIT_COMMAND = /^git\.commit(?:Staged|All|Empty)?(?:Signed|Amend)?(?:NoVerify)?$/;
const CONFIGURE_IDENTITY = 'git.singularityConfigureIdentity';
const IDENTITY_OPERATIONS = new Set(['git.merge', 'git.rebase', 'git.cherryPick', 'git.cherryPickRef']);

function validateIdentity(value, email = false) {
  if (!value.trim()) return email ? 'Enter your commit email.' : 'Enter your commit author name.';
  if (/[\x00-\x1f\x7f<>]/.test(value)) return 'Use a single line without control characters or angle brackets.';
  if (email && !/^[^\s@]+@[^\s@]+$/.test(value.trim())) return 'Enter an email address, such as name@example.com.';
  return undefined;
}

// An unborn branch has a name but no revision. Do not ask Git to log it before
// its first commit. Keep explicit queries for other (e.g. remote) refs working.
function adaptHistory(provider) {
  if (!provider) return provider;
  const unborn = () => provider.currentHistoryItemRef && !provider.currentHistoryItemRef.revision;
  return new Proxy(provider, { get(target, key) {
    if (unborn() && ['currentHistoryItemRef', 'currentHistoryItemRemoteRef', 'currentHistoryItemBaseRef'].includes(key)) return undefined;
    const value = Reflect.get(target, key);
    if (key === 'provideHistoryItems' && typeof value === 'function') return (options, ...args) => {
      if (unborn() && (!options?.historyItemRefs?.length || options.historyItemRefs.includes(target.currentHistoryItemRef.id))) return Promise.resolve([]);
      return value.call(target, options, ...args);
    };
    if (key === 'resolveHistoryItemRefsCommonAncestor' && typeof value === 'function') return (refs, ...args) => {
      if (unborn() && refs.includes(target.currentHistoryItemRef.id)) return Promise.resolve(undefined);
      return value.call(target, refs, ...args);
    };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

function adaptGitApi(api, plugin) {
  if (plugin.model.id.toLowerCase() !== 'vscode.git') return api;
  const pendingSetup = new Map();
  const github = createGitHubService(api);
  const git = () => api.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
  async function repositoryFor(argument) {
    const model = git();
    if (!model?.repositories.length) return undefined;
    const uri = argument?.rootUri || argument?.resourceUri || (argument?.scheme ? argument : undefined)
      || (typeof argument === 'string' ? (argument.startsWith('file:') ? api.Uri.parse(argument) : api.Uri.file(argument)) : undefined)
      || (typeof argument?.root === 'string' ? api.Uri.file(argument.root) : undefined);
    const explicit = uri && model.getRepository(uri);
    if (explicit) return explicit;
    if (uri) throw new Error('The selected Git repository is no longer open. Open it again before continuing.');
    if (model.repositories.length === 1) return model.repositories[0];
    const pick = await api.window.showQuickPick(model.repositories.map(repository => ({
      label: repository.rootUri.fsPath.split(/[\\/]/).pop(), description: repository.rootUri.fsPath, repository
    })), { title: 'Git: Select repository', placeHolder: 'Choose the repository for this operation', ignoreFocusOut: true });
    return pick?.repository;
  }
  async function configure(repository, force) {
    const [name, email] = await Promise.all([repository.getConfig('user.name'), repository.getConfig('user.email')]);
    if (!force && name?.trim() && email?.trim()) return true;
    // Collect both values before writing either. Escape/cancel leaves Git and
    // the index untouched; existing global identity is inherited as usual.
    const title = `Git identity — ${repository.rootUri.fsPath.split(/[\\/]/).pop()}`;
    const author = await api.window.showInputBox({ title, prompt: 'Commit author name (saved only for this repository)', value: name || '', ignoreFocusOut: true, validateInput: value => validateIdentity(value) });
    if (author === undefined) return false;
    const address = await api.window.showInputBox({ title, prompt: 'Commit email (included in commit history; saved only for this repository)', value: email || '', ignoreFocusOut: true, validateInput: value => validateIdentity(value, true) });
    if (address === undefined) return false;
    if (validateIdentity(author) || validateIdentity(address, true)) throw new Error('Enter a valid Git author name and email.');
    await repository.setConfig('user.name', author.trim());
    await repository.setConfig('user.email', address.trim());
    return true;
  }
  async function ensureIdentity(repository, force = false) {
    const key = repository.rootUri.toString();
    if (!pendingSetup.has(key)) pendingSetup.set(key, configure(repository, force).finally(() => pendingSetup.delete(key)));
    return pendingSetup.get(key);
  }
  async function withIdentity(argument, action, force = false) {
    try {
      if (api.workspace.isTrusted === false) throw new Error('Trust this workspace before configuring Git or committing.');
      const repository = await repositoryFor(argument);
      if (!repository) {
        if (force) await api.window.showInformationMessage('Open or initialize a Git repository to configure its commit identity.');
        return;
      }
      if (await ensureIdentity(repository, force)) return await action(repository);
    } catch (error) {
      await api.window.showErrorMessage(`Git: ${error.message}`);
    }
  }
  return { ...api,
    commands: { ...api.commands,
      // Bundled Git's conflict notifications and post-commit actions should
      // return to Singularity's Git workspace, without opening the old pane.
      executeCommand(id, ...args) { return api.commands.executeCommand(id === 'workbench.view.scm' ? 'plain-editor.git-actions' : id, ...args); },
      registerCommand(id, callback, thisArg) {
      if (!COMMIT_COMMAND.test(id) && !IDENTITY_OPERATIONS.has(id)) return api.commands.registerCommand(id, callback, thisArg);
      const registration = api.commands.registerCommand(id, function (...args) {
        // Pass the chosen root back to Git, so multi-root selection and setup
        // always apply to the same repository. Preserve all other arguments.
        return withIdentity(args[0], repository => callback.apply(thisArg, [repository.rootUri, ...args.slice(1)]));
      }, thisArg);
      if (id !== 'git.commit') return registration;
      const settings = api.commands.registerCommand(CONFIGURE_IDENTITY, argument => withIdentity(argument, async () => {
        api.window.showInformationMessage('Git commit identity saved for this repository.');
      }, true));
      const inspect = api.commands.registerCommand('git.singularityInspect', async (root, section = 'changes', request) => {
        if (section === 'startup') return startupSnapshot(git());
        const repository = await repositoryFor(root);
        if (!repository) return undefined;
        if (section === 'preview') return gitPreview(repository, api, request);
        if (section === 'commit') return commitDetails(repository, git().git.path, request);
        if (section === 'commitPreview') return commitPreview(repository, git().git.path, request);
        if (section === 'graph') return branchGraph(repository, git().git.path, request);
        if (section === 'conflict') return conflictDetails(repository, api, git().git.path, request);
        const head = repository.state.HEAD;
        const cleanUrl = value => {
          try { const url = new URL(value); url.password = ''; if (url.protocol === 'https:' || url.protocol === 'http:') url.username = ''; return url.href; }
          catch { return value; }
        };
        const result = { root: repository.rootUri.toString(), remoteCount: repository.state.remotes.length,
          merging: await mergeState(repository.rootUri.fsPath), conflicts: repository.state.mergeChanges?.length || 0, head: head && {
          name: head.name, commit: head.commit, ahead: head.ahead || 0, behind: head.behind || 0
        } };
        if (section === 'branches') result.branches = (await repository.getBranches({ remote: false, count: 200 })).slice(0, 200).map(branch => ({ name: branch.name, commit: branch.commit }));
        if (section === 'history') {
          const offset = Math.max(0, Math.floor(Number(request?.offset) || 0));
          const commits = head?.commit ? await repository.log({ maxEntries: 21, skip: offset }) : [];
          result.historyHasMore = commits.length > 20;
          result.history = commits.slice(0, 20).map(commit => ({
            id: commit.hash, parents: commit.parents, message: commit.message, author: commit.authorName, date: commit.authorDate?.toISOString()
          }));
        }
        if (section === 'remotes') result.remotes = repository.state.remotes.map(remote => ({ name: remote.name, fetchUrl: cleanUrl(remote.fetchUrl), pushUrl: cleanUrl(remote.pushUrl) }));
        return result;
      });
      const operation = api.commands.registerCommand('git.singularityOperation', async (root, action, request) => {
        if (api.workspace.isTrusted === false) throw new Error('Trust this workspace before changing Git history.');
        const repository = await repositoryFor(root);
        if (!repository) throw new Error('Open a Git repository first.');
        try {
          if (action === 'resolveConflict') return await resolveConflict(repository, api, git().git.path, request);
          return await runGitOperation(repository, action, request, ensureIdentity);
        } catch (error) { throw new Error(String(error.stderr || error.message || error).trim().slice(0, 2000)); }
      });
      const githubCommand = api.commands.registerCommand('git.singularityGitHub', async (root, action, request) => github.run(root ? await repositoryFor(root) : undefined,action,request));
      return { dispose() { githubCommand.dispose(); operation.dispose(); inspect.dispose(); settings.dispose(); registration.dispose(); } };
    } },
    // scm.inputBox is a legacy getter which throws before a provider exists.
    // Inherit the namespace instead of eagerly reading its getters with spread.
    scm: Object.create(api.scm, { createSourceControl: { value: function (...args) {
      const control = api.scm.createSourceControl(...args);
      let owner = control, descriptor;
      while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, 'historyProvider');
        owner = Object.getPrototypeOf(owner);
      }
      let provider = control.historyProvider;
      // Keep the original SourceControl object: Git resolves repository menu
      // arguments by object identity, especially when several repos are open.
      Object.defineProperty(control, 'historyProvider', {
        configurable: true, enumerable: true,
        get: descriptor?.get || (() => provider),
        set(value) {
          const adapted = adaptHistory(value);
          if (descriptor?.set) descriptor.set.call(this, adapted);
          else provider = adapted;
        }
      });
      return control;
    }, enumerable: true } })
  };
}

module.exports = { adaptGitApi, adaptHistory, validateIdentity, COMMIT_COMMAND, CONFIGURE_IDENTITY };
