'use strict';

const URI = require('@theia/core/lib/common/uri').default;
const { ScmService } = require('@theia/scm/lib/browser/scm-service');
const { PluginMenuCommandAdapter } = require('@theia/plugin-ext/lib/main/browser/menus/plugin-menu-command-adapter');
const { BaseWidget, codicon } = require('@theia/core/lib/browser');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { EditorManager } = require('@theia/editor/lib/browser/editor-manager');
const { Saveable } = require('@theia/core/lib/browser/saveable');
const { parsePatch } = require('./git-diff.cjs');
const { Emitter } = require('@theia/core/lib/common/event');
const { layoutGraph } = require('./git-graph.cjs');
const { createGitSplitter } = require('./git-splitter');
const { createGitHubForm } = require('./git-github-form');
const { ConfirmDialog } = require('@theia/core/lib/browser/dialogs');
const { gitConfirmation } = require('./git-confirmation.cjs');

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const MORE_ACTIONS = [
  ['Branches', [['Create branch…', 'git.branch'], ['Switch branch…', 'git.checkout'], ['Rename branch…', 'git.renameBranch'], ['Delete branch…', 'git.deleteBranch'], ['Rebase onto branch…', 'git.rebase'], ['Abort rebase', 'git.rebaseAbort'], ['Cherry-pick commit…', 'git.cherryPick'], ['Abort cherry-pick', 'git.cherryPickAbort']]],
  ['Stashes', [['Stash changes…', 'git.stash'], ['Stash including new files…', 'git.stashIncludeUntracked'], ['Apply stash…', 'git.stashApply'], ['Pop stash…', 'git.stashPop'], ['Drop stash…', 'git.stashDrop']]],
  ['Remote', [['Fetch all', 'git.fetchAll'], ['Fetch and prune', 'git.fetchPrune'], ['Pull with rebase', 'git.pullRebase'], ['Push to…', 'git.pushTo'], ['Push tags', 'git.pushTags']]],
  ['Tags and identity', [['Create tag…', 'git.createTag'], ['Delete tag…', 'git.deleteTag'], ['Configure commit identity…', 'git.singularityConfigureIdentity']]]
];
const REMOTE_COMMANDS = new Set(['git.pull','git.push','git.fetch','git.fetchAll','git.fetchPrune','git.pullRebase','git.pushTo','git.pushTags']);

class GitWidget extends BaseWidget {
  constructor(container, commands) {
    super(); this.id = 'plain-git'; this.title.label = 'Git'; this.title.caption = 'Git';
    this.title.iconClass = codicon('git-branch'); this.title.closable = true;
    this.addClass('plain-git-workspace'); this.node.setAttribute('aria-label', 'Git workspace');
    this.container = container; this.commands = commands; this.scm = container.get(ScmService);
    this.dirtyChanged = new Emitter(); this.contentChanged = new Emitter(); this.toDispose.push(this.dirtyChanged, this.contentChanged);
    this.saveable = { dirty: false, autosaveable: false, onDirtyChanged: this.dirtyChanged.event, onContentChanged: this.contentChanged.event,
      revert: async () => this.setResolutionDirty(false), save: async () => {
      if (this.saveResolution) await this.saveResolution();
      if (this.saveable.dirty) throw new Error(this.notice || 'The resolution was not saved.');
    } };
    this.section = 'changes'; this.listeners = []; this.generation = 0; this.fileLimit = 100; this.previewGeneration = 0;
    this.node.innerHTML = `<div class="plain-git-repository"><label><small>Repository</small><select aria-label="Repository"></select></label><button class="plain-git-branch" data-git-section="branches" title="Manage branches"><small>Current branch</small><span class="plain-git-head"></span></button><small data-git-local hidden title="Commits stay on this computer. No GitHub account or remote is required.">Local only</small><div class="plain-git-primary"><button data-git-command="git.pull">Pull</button><button data-git-command="git.push">Push</button><button data-git-command="git.fetch">Fetch</button><button data-git-action="more" title="More Git actions">More…</button></div><button data-git-action="refresh" title="Refresh Git" aria-label="Refresh Git"><span class="codicon codicon-refresh" aria-hidden="true"></span></button></div>
      <nav aria-label="Git sections">${['changes','branches','history','remotes'].map(section => `<button data-git-section="${section}">${section[0].toUpperCase()+section.slice(1)}</button>`).join('')}</nav>
      <div class="plain-git-status" role="status" aria-live="polite"></div>
      <div class="plain-git-merge" hidden></div><div class="plain-git-more" id="plain-git-more" role="menu" aria-label="More Git actions" hidden></div>
      <div class="plain-git-content"><div class="plain-git-sidebar"><div class="plain-git-actions"></div><div class="plain-git-list"></div>
        <div class="plain-git-commit"><label for="plain-git-message">Commit message</label><textarea id="plain-git-message" rows="3" placeholder="Describe your changes"></textarea><button data-git-action="commit" class="theia-button">Commit staged changes</button><small>Stage the files you want to include before committing.</small></div>
      </div><div class="plain-git-main-splitter" aria-label="Resize commit list and changes"></div><section class="plain-git-review" aria-label="Review changes"><div class="plain-git-review-title"></div><div class="plain-git-review-body"></div></section></div><div class="plain-git-empty" hidden><p>Initialize a local repository to track changes in your folder. No GitHub account or remote is needed.</p><p>Open your project folder from Files first, or choose a folder when initializing.</p><button data-git-command="git.init">Initialize local repository…</button><button data-git-command="git.clone">Clone repository…</button><button data-git-action="github-create">Create GitHub repository…</button></div>`;
    this.select = this.node.querySelector('select'); this.status = this.node.querySelector('[role="status"]');
    this.fullscreenBar=element('div',undefined,'plain-git-fullscreen-bar');this.fullscreenBar.hidden=true;
    this.fullscreenTitle=element('strong');this.fullscreenBar.append(this.fullscreenTitle);
    this.button(this.fullscreenBar,'Exit full screen',()=>this.setFullscreen(false));this.node.prepend(this.fullscreenBar);
    const fullscreen=this.button(this.node.querySelector('.plain-git-primary'),'Full screen',()=>this.setFullscreen(true));fullscreen.dataset.gitFullscreen='';
    this.list = this.node.querySelector('.plain-git-list'); this.actions = this.node.querySelector('.plain-git-actions');
    this.message = this.node.querySelector('textarea'); this.head = this.node.querySelector('.plain-git-head');
    this.reviewTitle = this.node.querySelector('.plain-git-review-title'); this.review = this.node.querySelector('.plain-git-review-body');
    this.more = this.node.querySelector('.plain-git-more'); this.mergeBanner = this.node.querySelector('.plain-git-merge');
    this.outerFraction = .36; this.filesFraction = .28; this.mergeLayout = 'columns'; this.mergeRows = .45; this.mergeColumns = .64;
    this.bindOuterSplitter();
    this.branchMenu = element('div', undefined, 'plain-git-branch-menu'); this.branchMenu.hidden = true;
    this.branchMenu.setAttribute('role', 'menu'); this.branchMenu.setAttribute('aria-label', 'Branch actions'); this.node.append(this.branchMenu);
    this.outsideBranch = event => { if (!this.branchMenu.contains(event.target)) this.closeBranchMenu(); };
    document.addEventListener('pointerdown', this.outsideBranch);
    this.node.addEventListener('keydown', event => {
      if(event.key==='Escape'&&this.fullscreen&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();this.setFullscreen(false);return;}
      if (this.branchMenu.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeBranchMenu(true); }
      else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); const items = [...this.branchMenu.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (event.key === 'Tab') this.closeBranchMenu();
    });
    const moreButton = this.node.querySelector('[data-git-action="more"]');
    moreButton.setAttribute('aria-haspopup', 'menu'); moreButton.setAttribute('aria-expanded', 'false'); moreButton.setAttribute('aria-controls', 'plain-git-more');
    for (const [label, actions] of MORE_ACTIONS) {
      this.more.append(element('h3', label));
      for (const [title, command] of actions) {
        const button = element('button', title); button.dataset.gitCommand = command; button.setAttribute('role', 'menuitem'); this.more.append(button);
      }
    }
    this.outsideMore = event => { if (!this.more.contains(event.target) && !moreButton.contains(event.target)) this.toggleMore(false); };
    document.addEventListener('pointerdown', this.outsideMore);
    this.node.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.more.hidden) { event.preventDefault(); event.stopPropagation(); this.toggleMore(false); moreButton.focus(); }
      if (!this.more.hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = [...this.more.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && this.section === 'changes') { event.preventDefault(); event.stopPropagation(); if (this.editingConflict) this.saveResolution?.(); else this.commit(); }
    });
    this.message.addEventListener('input', () => { if (this.repository()) this.repository().input.value = this.message.value; });
    this.select.addEventListener('change', () => {
      if (this.blockUnsavedResolution()) { this.select.value = this.root || ''; return; }
      this.closeGitHubForm(false);
      this.root = this.select.value; const repository = this.repository(); if (repository) this.scm.selectedRepository = repository;
      this.historyOffset = 0; this.selectedCommit = undefined; this.fileLimit = 100;
      this.watchProvider(); this.refresh();
    });
    this.node.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (this.githubForm && this.busy && (button.dataset.gitSection || button.dataset.gitCommand)) return;
      if ((button.dataset.gitSection || button.dataset.gitCommand || button.dataset.gitAction === 'refresh') && this.blockUnsavedResolution()) return;
      if (button.dataset.gitAction !== 'more') this.toggleMore(false);
      if (button.dataset.gitSection) {
        this.closeGitHubForm(false);
        if (this.section !== button.dataset.gitSection) { this.closeBranchMenu(); this.section = button.dataset.gitSection; this.editingConflict = false; this.previewGeneration++; }
        this.refresh(); return;
      }
      if (this.busy) return;
      if (button.dataset.gitCommand) { this.run(button.dataset.gitCommand); return; }
      switch (button.dataset.gitAction) {
        case 'fullscreen': this.setFullscreen(true);break;
        case 'refresh': this.viewKey = undefined; this.editingConflict = false; this.run('git.refresh'); break;
        case 'commit': this.commit(); break;
        case 'more': this.toggleMore(); break;
        case 'github-create': this.showGitHubForm(); break;
      }
    });
  }
  setResolutionDirty(dirty) { if (this.saveable.dirty !== dirty) { this.saveable.dirty = dirty; this.dirtyChanged.fire(); } this.contentChanged.fire(); }
  setFullscreen(value) {
    if(value&&!this.fullscreen)this.fullscreenFocus=document.activeElement;
    this.fullscreen=value;this.toggleClass('plain-git-fullscreen',value);document.body.classList.toggle('plain-git-fullscreen-active',value);
    this.fullscreenBar.hidden=!value;this.fullscreenTitle.textContent=this.reviewTitle.textContent||'Git';
    if(value)this.fullscreenBar.querySelector('button').focus();
    else if(this.fullscreenFocus?.isConnected){this.fullscreenFocus.focus();this.fullscreenFocus=undefined;}
    requestAnimationFrame(()=> {if(!this.isDisposed){this.mergeEditor?.layout();this.update();}});
  }
  onBeforeHide(message) {if(this.fullscreen)this.setFullscreen(false);super.onBeforeHide(message);}
  bindOuterSplitter() {
    this.outerSplitter?.dispose();
    this.outerSplitter = createGitSplitter(this.node.querySelector('.plain-git-content'), this.node.querySelector('.plain-git-main-splitter'), {
      variable: '--plain-git-sidebar-width', value: this.outerFraction, onChange: value => this.outerFraction = value
    });
  }
  storeState() { return { section: this.section, outerFraction: this.outerFraction, filesFraction: this.filesFraction, mergeLayout:this.mergeLayout,mergeRows:this.mergeRows,mergeColumns:this.mergeColumns }; }
  restoreState(state) {
    if (['changes','branches','history','remotes'].includes(state?.section)) this.section = state.section;
    for (const key of ['outerFraction','filesFraction','mergeRows','mergeColumns']) if (Number.isFinite(state?.[key]) && state[key] > 0 && state[key] < 1) this[key] = state[key];
    if (['columns','rows'].includes(state?.mergeLayout)) this.mergeLayout = state.mergeLayout;
    this.bindOuterSplitter();
  }
  blockUnsavedResolution() {
    if (!this.saveable.dirty) return false;
    this.status.textContent = 'Save and stage the resolution, or discard its edits, before leaving this view.'; return true;
  }
  toggleMore(visible = this.more.hidden) {
    this.more.hidden = !visible; this.node.querySelector('[data-git-action="more"]').setAttribute('aria-expanded', String(visible));
    if (visible) this.more.querySelector('button')?.focus();
  }
  repository() { return this.scm.repositories.find(repository => repository.provider.id === 'git' && repository.provider.rootUri === this.root); }
  open() {
    if (this.busy || this.isDisposed) return;
    if (!this.listening) {
      this.listening = true;
      const selected = this.scm.selectedRepository;
      if (selected?.provider.id === 'git') this.root = selected.provider.rootUri;
      let ready = this.commands.isEnabled('git.singularityInspect');
      this.listeners.push(this.scm.onDidAddRepository(() => this.schedule()), this.scm.onDidRemoveRepository(() => this.schedule()),
        this.commands.onCommandsChanged(() => {
          const next = this.commands.isEnabled('git.singularityInspect');
          if (next !== ready) { ready = next; this.schedule(); }
        }));
    }
    this.watchProvider();
    if (this.isHidden) return;
    return this.refresh();
  }
  dispose() {
    if(this.fullscreen)this.setFullscreen(false);
    this.mergeEditor?.dispose();
    this.githubForm?.dispose();
    this.generation++; this.previewGeneration = (this.previewGeneration || 0) + 1; clearTimeout(this.timer); this.providerListener?.dispose();
    document.removeEventListener('pointerdown', this.outsideMore);
    document.removeEventListener('pointerdown', this.outsideBranch); this.outerSplitter?.dispose(); this.filesSplitter?.dispose();
    this.listeners.splice(0).forEach(listener => listener.dispose()); super.dispose();
  }
  onActivateRequest(message) { super.onActivateRequest(message); this.select.focus(); }
  // Restored visible tabs are attached without a separate after-show message.
  // Start repository listeners here too, before plugins finish registering Git.
  onAfterAttach(message) { super.onAfterAttach(message); this.open(); }
  onAfterShow(message) { super.onAfterShow(message); this.open(); }
  async prepareForStartup() {
    this.restoring = true; clearTimeout(this.timer); this.generation++;
    try {
      if (!this.commands.isEnabled('git.singularityInspect')) throw new Error('Git is unavailable. Check that the built-in Git extension is enabled.');
      const snapshot = await this.commands.executeCommand('git.singularityInspect', undefined, 'startup');
      await require('./git-startup.cjs').waitForResources(this.scm, snapshot);
      if (!await this.refresh()) throw new Error(this.status.textContent || 'Could not restore Git data.');
    } finally { this.restoring = false; }
  }
  watchProvider() {
    this.providerListener?.dispose(); this.providerListener = this.repository()?.provider.onDidChange(() => this.schedule());
  }
  schedule() {
    if (this.isDisposed || this.isHidden || this.busy || this.restoring) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 150);
  }
  button(parent, label, action) {
    const button = element('button', label); button.type = 'button'; parent.append(button);
    button.addEventListener('click', event => { if (!this.busy) return action(event); }); return button;
  }
  async refresh() {
    if (this.isDisposed || this.busy || this.githubForm) return;
    const generation = ++this.generation;
    const repositories = this.scm.repositories.filter(repository => repository.provider.id === 'git');
    if (!this.repository()) this.root = repositories[0]?.provider.rootUri;
    this.select.replaceChildren(...repositories.map(repository => {
      const uri = new URI(repository.provider.rootUri);
      const duplicate = repositories.some(other => other !== repository && new URI(other.provider.rootUri).path.base === uri.path.base);
      const option = element('option', duplicate ? uri.path.toString() : uri.path.base);
      option.value = repository.provider.rootUri; option.title = uri.path.toString(); return option;
    })); this.select.value = this.root || '';
    this.select.title = this.root ? new URI(this.root).path.toString() : 'Repository';
    const repository = this.repository();
    this.node.querySelector('.plain-git-content').dataset.section = this.mergeEditor && this.editingConflict && this.section === 'changes' ? 'conflict' : this.section;
    this.node.querySelector('.plain-git-empty').hidden = !!repository;
    this.node.querySelector('.plain-git-content').hidden = !repository;
    this.node.querySelector('.plain-git-primary').hidden = !repository;
    this.node.querySelector('nav').hidden = !repository;
    this.status.textContent = this.notice || '';
    for (const button of this.node.querySelectorAll('[data-git-section]')) button.setAttribute('aria-pressed', String(button.dataset.gitSection === this.section));
    this.node.querySelector('.plain-git-commit').hidden = this.section !== 'changes';
    this.node.querySelector('.plain-git-branch').disabled = !repository;
    if (!repository) { this.closeBranchMenu(); this.head.textContent = 'No repository'; this.info = undefined; this.node.querySelector('[data-git-local]').hidden = true; this.viewKey = undefined; return true; }
    this.watchProvider();
    if (document.activeElement !== this.message) this.message.value = repository.input.value;
    if (!this.commands.isEnabled('git.singularityInspect')) { this.status.textContent = 'Loading Git…'; return; }
    this.node.setAttribute('aria-busy', 'true');
    if (!this.viewKey) this.status.textContent = 'Loading…';
    try {
      const info = await this.commands.executeCommand('git.singularityInspect', this.root, this.section, { offset: this.historyOffset || 0 });
      if (this.isDisposed || generation !== this.generation) return;
      if (!info) throw new Error('Git is starting. Try Refresh in a moment.');
      this.status.textContent = this.notice || '';
      const head = info.head;
      this.info = info;
      this.node.querySelector('[data-git-local]').hidden = !!info.remoteCount;
      for (const button of this.node.querySelectorAll('[data-git-command]')) {
        const command = button.dataset.gitCommand;
        if (!REMOTE_COMMANDS.has(command)) continue;
        button.disabled = !info.remoteCount || (command === 'git.push' && !head?.commit);
        button.title = info.remoteCount ? '' : 'Add a remote in Remotes to use this action. Local commits do not need one.';
      }
      this.head.textContent = (head?.name || head?.commit?.slice(0,7) || 'No commits yet') + (head?.ahead ? ` · ${head.ahead} ahead` : '') + (head?.behind ? ` · ${head.behind} behind` : '');
      this.node.querySelector('[data-git-action="commit"]').textContent = info.merging ? 'Finish merge' : `Commit to ${head?.name || 'branch'}`;
      this.mergeBanner.hidden = !info.merging && !info.conflicts;
      this.mergeBanner.replaceChildren(element('span', info.conflicts ? `${info.conflicts} conflicted file(s). Resolve each file, then finish the merge.` : 'All conflicts resolved. Commit to finish this merge.'));
      if (!this.mergeBanner.hidden) {
        this.button(this.mergeBanner, 'Show conflicts', () => { this.section = 'changes'; this.refresh(); });
        this.button(this.mergeBanner, 'Abort merge…', () => this.confirmAbortMerge()).classList.add('plain-git-danger');
      }
      // Keep rows under the pointer stable during background Git refreshes.
      // Replace them only when the displayed section or file list changes.
      const viewKey = JSON.stringify([this.root, this.section, info, this.section === 'changes'
        ? [this.fileLimit, repository.provider.groups.map(group => [group.id, group.label, group.resources.length, group.resources.slice(0, this.fileLimit).map(resource => resource.sourceUri.toString())])] : undefined]);
      if (viewKey === this.viewKey) {
        if (this.section === 'changes' && this.selectedResource && !this.editingConflict) {
          for (const group of repository.provider.groups) {
            const resource = group.resources.find(item => `${group.id}:${item.sourceUri}` === this.selectedResource);
            if (resource) await this.selectResource(resource, group.id, true);
          }
        }
        return true;
      }
      this.closeBranchMenu(); this.viewKey = viewKey; this.list.replaceChildren(); this.actions.replaceChildren();
      const summaries = {
        changes: ['Review your changes', 'Select a file to review it. Stage the changes you want to include, then write a commit message.'],
        branches: ['Work on a branch', 'Create a branch for your work, switch between branches, or merge another branch into the current one.'],
        history: ['Commit history', 'Select a commit to review its changed files and line-by-line diffs.'],
        remotes: ['Connect your repository', 'Remotes are the repositories you fetch from and push to. Adding a remote does not upload your files.']
      };
      const keepConflict = this.section === 'changes' && this.editingConflict && repository.provider.groups.some(group => group.id === 'merge' && group.resources.some(resource => `merge:${resource.sourceUri}` === this.selectedResource));
      if (!keepConflict) { this.previewGeneration++; this.editingConflict = false; this.showReview(...summaries[this.section]); }
      if (this.section === 'changes') await this.renderChanges(repository);
      if (this.section === 'branches') await this.renderBranches();
      if (this.section === 'history') await this.renderHistory(info);
      if (this.section === 'remotes') this.renderRemotes(info);
      return true;
    } catch (error) { if (generation === this.generation) this.status.textContent = error.message; return false; }
    finally { if (generation === this.generation) this.node.removeAttribute('aria-busy'); }
  }
  async renderChanges(repository) {
    const order={merge:0,index:1,workingTree:2,untracked:3};
    const groups = repository.provider.groups.filter(group => group.resources.length).slice().sort((a,b)=>(order[a.id]??4)-(order[b.id]??4));
    if (!groups.length) { this.list.append(element('p', 'No changes', 'plain-git-muted')); this.showReview('Your working tree is clean', 'Changes you make to this repository will appear here. You can review your history or create a branch to start something new.'); }
    let selected;
    for (const group of groups) {
      const [label, hint, stage] = {
        index: ['Staged changes', 'Included in your next commit', 'staged'],
        workingTree: ['Unstaged changes', 'Stage these to include them in a commit', 'unstaged'],
        untracked: ['New files', 'Not tracked until you stage them', 'untracked'],
        merge: ['Merge conflicts', 'Resolve and stage each file', 'conflicts']
      }[group.id] || [group.label, '', 'unstaged'];
      const section = element('section', undefined, 'plain-git-change-group'); section.dataset.stage = stage; this.list.append(section);
      const heading = element('h3', `${label} (${group.resources.length})`); section.append(heading, element('small', hint, 'plain-git-muted'));
      const files=element('div',undefined,'plain-git-change-files');files.setAttribute('aria-label',label);files.tabIndex=0;section.append(files);
      if (group.id !== 'merge') this.button(heading, group.id === 'index' ? 'Unstage all' : 'Stage all', () => {
        return this.run(group.id === 'index' ? 'git.unstageAll' : group.id === 'untracked' ? 'git.stageAllUntracked' : 'git.stageAllTracked');
      });
      for (const resource of group.resources.slice(0, this.fileLimit)) {
        const row = element('div', undefined, 'plain-git-row');
        const key = `${group.id}:${resource.sourceUri}`;
        const name = this.button(row, new URI(repository.provider.rootUri).relative(resource.sourceUri)?.toString() || resource.sourceUri.path.base, () => this.selectResource(resource, group.id));
        name.className = 'plain-git-file'; name.title = resource.sourceUri.path.toString(); name.setAttribute('aria-pressed', 'false'); row.dataset.resource = key;
        if (key === this.selectedResource) selected = {resource, group: group.id};
        if (group.id === 'merge') {row.append(element('span','Conflict','plain-git-conflict-label'));this.button(row, 'Resolve', () => this.resolveResource(resource));}
        if (group.id !== 'merge') this.button(row, group.id === 'index' ? 'Unstage' : 'Stage', () => this.runResource(group.id === 'index' ? 'git.unstage' : 'git.stage', resource));
        if (group.id !== 'merge' && group.id !== 'index') this.button(row, 'Discard', () => this.runResource('git.clean', resource)).classList.add('plain-git-discard');
        files.append(row);
      }
      if (group.resources.length > this.fileLimit) this.button(files, 'Show more files…', () => { this.fileLimit += 100; this.viewKey = undefined; this.refresh(); });
    }
    if (selected && !(this.editingConflict && selected.group === 'merge')) await this.selectResource(selected.resource, selected.group);
  }
  showReview(title, message) {
    this.mergeEditor?.dispose(); this.mergeEditor = undefined; this.saveResolution = undefined;
    const content = this.node.querySelector('.plain-git-content');
    if (content.dataset.section === 'conflict') content.dataset.section = this.section;
    content.classList.remove('plain-git-show-conflict-files');
    this.filesSplitter?.dispose(); this.filesSplitter = undefined;
    this.review.classList.remove('plain-git-history-view', 'plain-git-graph-view', 'plain-git-merge-view');
    this.reviewTitle.classList.remove('plain-git-history-heading', 'plain-git-merge-heading');
    this.reviewTitle.textContent = title; this.review.replaceChildren();
    if (message) this.review.append(element('p', message, 'plain-git-review-note'));
  }
  renderPatch(parent, text, plainText = false, toolbar) {
    const { rows, metadata, added, removed } = plainText ? {
      rows: text.split('\n').map((text,index) => ({text, kind:'added', newLine:index+1})), metadata: [], added: text.split('\n').length, removed: 0
    } : parsePatch(text);
    (toolbar || parent).append(element('div', `+${added} additions · −${removed} deletions`, 'plain-git-diff-stats'));
    if (metadata.length) {
      const details = element('details', undefined, 'plain-git-patch-metadata');
      details.append(element('summary', 'File details'), element('pre', metadata.join('\n'))); (toolbar || parent).append(details);
    }
    this.renderLines(parent, rows);
  }
  renderLines(parent, rows) {
    const patch = element('div', undefined, 'plain-git-patch'); patch.setAttribute('aria-label', 'File diff');
    for (const row of rows) {
      const line = element('div', undefined, `plain-git-diff-line ${row.kind}`);
      line.append(element('span', row.oldLine === undefined ? '' : String(row.oldLine), 'line-number'), element('span', row.newLine === undefined ? '' : String(row.newLine), 'line-number'), element('code', row.text || ' ')); patch.append(line);
    }
    parent.append(patch);
  }
  renderPreview(parent, preview, requestPage) {
    const controls = element('div', undefined, 'plain-git-preview-controls');
    const body = element('div', undefined, 'plain-git-preview-body'); parent.append(controls, body);
    let requestId = 0;
    const compact = () => {
      requestId++; controls.replaceChildren(); body.replaceChildren();
      this.button(controls,'Full screen',()=>this.setFullscreen(true)).dataset.gitFullscreen='';
      if (preview.canExpand) this.button(controls, 'Expand whole file', () => full(0)).setAttribute('aria-expanded', 'false');
      if (preview.text) this.renderPatch(body, preview.text, preview.plainText, parent.classList.contains('plain-git-history-diff') ? controls : undefined);
    };
    const full = async lineOffset => {
      const id = ++requestId;
      controls.replaceChildren(); this.button(controls, 'Show changes only', compact).setAttribute('aria-expanded', 'true');
      this.button(controls,'Full screen',()=>this.setFullscreen(true)).dataset.gitFullscreen='';
      body.replaceChildren(element('p', 'Loading whole file…', 'plain-git-review-note'));
      try {
        const page = await requestPage(lineOffset);
        if (this.isDisposed || !parent.isConnected || id !== requestId) return;
        body.replaceChildren(); controls.title = page.note;
        if (!page.fullFile) { body.append(element('p', page.note, 'plain-git-review-note')); return; }
        controls.append(element('small', `Lines ${page.startLine+1}–${page.startLine+page.rows.length} of ${page.totalLines}`));
        if (page.previousLine !== undefined) this.button(controls, 'Previous lines', () => full(page.previousLine));
        if (page.nextLine !== undefined) this.button(controls, 'Next lines', () => full(page.nextLine));
        const changes = new Set(parsePatch(preview.text || '').rows.filter(row => row.kind === (page.side === 'before' ? 'removed' : 'added')).map(row => page.side === 'before' ? row.oldLine : row.newLine));
        this.renderLines(body, page.rows.map(row => ({...row, kind: preview.plainText || changes.has(row.newLine ?? row.oldLine) ? (page.side === 'before' ? 'removed' : 'added') : 'context'})));
      } catch (error) { if (parent.isConnected && id === requestId) body.replaceChildren(element('p', error.message, 'plain-git-review-note')); }
    };
    compact();
  }
  assertSavedFiles() {
    const root = new URI(this.root);
    if (this.container.get(EditorManager).all.some(widget => root.isEqualOrParent(widget.editor.uri) && Saveable.get(widget)?.dirty)) throw new Error('Save your open file changes before merging or saving a resolution.');
  }
  async resolveResource(resource) {
    if (this.blockUnsavedResolution()) return;
    const generation = ++this.previewGeneration;
    this.editingConflict = true;
    this.selectedResource = `merge:${resource.sourceUri}`;
    this.showReview(resource.sourceUri.path.base, 'Loading conflict…');
    try {
      this.assertSavedFiles();
      const details = await this.commands.executeCommand('git.singularityInspect', this.root, 'conflict', { uri: resource.sourceUri.toString() });
      if (this.isDisposed || generation !== this.previewGeneration) return;
      this.editingConflict = true;
      this.showReview(resource.sourceUri.path.base, '');
      this.review.classList.add('plain-git-merge-view'); this.reviewTitle.classList.add('plain-git-merge-heading');
      this.node.querySelector('.plain-git-content').dataset.section = 'conflict';
      const {MergeResolutionEditor} = require('./git-merge-editor');
      this.mergeEditor = new MergeResolutionEditor(this,details);
      this.saveResolution = () => this.mergeEditor?.save();
    } catch (error) { this.editingConflict = false; if (generation === this.previewGeneration) this.showReview(resource.sourceUri.path.base, error.message); }
  }
  async selectResource(resource, group, quiet = false) {
    if (this.blockUnsavedResolution()) return;
    if (group === 'merge') { if (!quiet) return this.resolveResource(resource); return; }
    this.editingConflict = false;
    this.selectedResource = `${group}:${resource.sourceUri}`;
    for (const row of this.list.querySelectorAll('[data-resource]')) {
      const selected = row.dataset.resource === this.selectedResource;
      row.classList.toggle('selected', selected); row.querySelector('.plain-git-file').setAttribute('aria-pressed', String(selected));
    }
    const generation = ++this.previewGeneration;
    if (!quiet) this.showReview(resource.sourceUri.path.base, group === 'merge' ? 'This file has conflicts. Choose Resolve to open the three-way merge editor.' : 'Loading preview…');
    if (group === 'merge') return;
    try {
      const preview = await this.commands.executeCommand('git.singularityInspect', this.root, 'preview', { uri: resource.sourceUri.toString(), staged: group === 'index' });
      if (this.isDisposed || generation !== this.previewGeneration) return;
      this.showReview(resource.sourceUri.path.base, preview.note);
      const root = this.root;
      this.renderPreview(this.review, preview, lineOffset => this.commands.executeCommand('git.singularityInspect', root, 'preview', {uri:resource.sourceUri.toString(),staged:group === 'index',fullFile:true,lineOffset}));
    } catch (error) { if (generation === this.previewGeneration) this.showReview(resource.sourceUri.path.base, error.message); }
  }
  renderBranches() {
    return this.renderBranchGraph();
  }
  closeBranchMenu(restore = false) {
    if (!this.branchMenu) return;
    this.branchMenu.hidden = true;
    if (restore && this.branchMenuAnchor?.isConnected) this.branchMenuAnchor.focus();
  }
  openGitMenu(event, anchor, title, actions) {
    event.preventDefault(); event.stopPropagation();
    if (this.busy || this.blockUnsavedResolution()) return;
    this.toggleMore(false); this.branchMenuAnchor = anchor; this.branchMenu.replaceChildren(element('strong', title));
    this.branchMenu.setAttribute('aria-label', title);
    for (const [label, action, disabled = false] of actions) {
      const button = this.button(this.branchMenu, label, () => { this.closeBranchMenu(); return action(); });
      button.setAttribute('role','menuitem'); button.disabled = disabled;
    }
    this.branchMenu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const x = event.type === 'contextmenu' && event.clientX ? event.clientX : rect.left;
    const y = event.type === 'contextmenu' && event.clientY ? event.clientY : rect.bottom;
    this.branchMenu.style.left = `${Math.max(0,Math.min(x,innerWidth-this.branchMenu.offsetWidth-8))}px`;
    this.branchMenu.style.top = `${Math.max(0,Math.min(y,innerHeight-this.branchMenu.offsetHeight-8))}px`;
    this.branchMenu.querySelector('button:not(:disabled)')?.focus();
  }
  bindGitMenu(node, open) {
    node.setAttribute('aria-haspopup','menu');
    node.setAttribute('aria-keyshortcuts','Shift+F10');
    node.addEventListener('contextmenu', event => open(event));
    node.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event); });
  }
  openBranchMenu(event, branch, anchor) {
    const current = branch.current, head = this.info.head;
    const actions = [
      ['Switch to branch', () => this.run('git.checkout', branch.name), current || this.info.merging],
      [`Merge into ${head?.name || 'current branch'}…`, () => this.confirmMerge(branch, head), current || !head?.name || this.info.merging],
      ['Create branch from here…', () => this.run('git.branch', {id:branch.commit}), this.info.merging || !!this.info.conflicts],
      ['Rename current branch…', () => this.run('git.renameBranch'), !current || branch.remote],
      ['Delete branch…', () => {
        this.previewGeneration++; this.showReview(`Delete ${branch.name}?`, 'This removes the local branch label. Unmerged work requires a separate confirmation.');
        this.button(this.review, `Delete ${branch.name}`, () => this.run('git.deleteBranch', branch.name)).dataset.gitConfirmDelete = '';
        this.backToGraph();
      }, current || branch.remote || this.info.merging]
    ];
    if (current) actions.push(['Pull', () => this.run('git.pull'), !this.info.remoteCount], ['Push', () => this.run('git.push'), !this.info.remoteCount || !head?.commit]);
    this.openGitMenu(event,anchor,branch.name,actions);
  }
  openCommitMenu(event, commit, anchor) {
    const paused = this.info.merging || this.info.conflicts;
    this.openGitMenu(event,anchor,`Commit ${commit.id.slice(0,7)}`, [
      ['Create branch from commit…', () => this.run('git.branch', {id:commit.id}), paused],
      ['Create tag at commit…', () => this.run('git.createTag', {id:commit.id})],
      ['Cherry-pick commit…', () => this.confirmCommitAction(commit, 'cherryPick'), paused || !Array.isArray(commit.parents) || commit.parents.length > 1 || !this.info.head?.name || commit.id === this.info.head?.commit],
      ['Check out commit…', () => this.confirmCommitAction(commit, 'checkout'), paused || commit.id === this.info.head?.commit],
      ['Copy commit hash', () => this.perform(async () => { await navigator.clipboard.writeText(commit.id); return {message:'Commit hash copied.'}; })]
    ]);
  }
  backToGraph() {
    if (this.section === 'branches') this.button(this.review, 'Back to graph', () => this.renderBranchGraph()).className = 'plain-git-back';
  }
  confirmCommitAction(commit, action) {
    if (this.blockUnsavedResolution()) return;
    this.previewGeneration++;
    const cherryPick = action === 'cherryPick';
    this.showReview(`${cherryPick ? 'Cherry-pick' : 'Check out'} ${commit.id.slice(0,7)}?`, cherryPick
      ? `Apply this commit to ${this.info.head.name}. Commit or stash pending changes first. Conflicts may need resolution.`
      : 'This checks out the commit in detached HEAD mode. Create a branch before making new commits you want to keep.');
    this.button(this.review, cherryPick ? 'Cherry-pick commit' : 'Check out commit', () => this.perform(() => {
      this.assertSavedFiles();
      return this.commands.executeCommand(cherryPick ? 'git.cherryPickRef' : 'git.checkoutDetached', new URI(this.root).codeUri, cherryPick ? {id:commit.id} : commit.id);
    },this.confirmation(cherryPick?'git.cherryPickRef':'git.checkoutDetached',{source:commit.id.slice(0,7)}))).dataset.gitConfirmCommit = action;
    this.backToGraph();
  }
  async renderBranchGraph() {
    const generation = ++this.previewGeneration;
    this.showReview('Branch graph', 'Loading branches and commits…');
    try {
      const result = await this.commands.executeCommand('git.singularityInspect', this.root, 'graph', {limit:this.graphLimit || 100});
      if (this.isDisposed || generation !== this.previewGeneration) return;
      this.showReview('Branches', 'Right-click a branch or commit for Git actions.');
      this.review.classList.add('plain-git-graph-view');
      const toolbar = element('div', undefined, 'plain-git-actions plain-git-graph-actions');
      this.button(toolbar, 'Create branch…', () => this.run('git.branch')).disabled = !this.info.head?.commit || this.info.merging || !!this.info.conflicts;
      this.button(toolbar, 'Switch branch…', () => this.run('git.checkout')).disabled = !this.info.head?.commit || this.info.merging || !!this.info.conflicts;
      this.review.prepend(toolbar);
      const graph = layoutGraph(result.commits), height = graph.rows.length * 58, width = graph.width * 20 + 20;
      const layout = element('div', undefined, 'plain-git-graph'); layout.style.gridTemplateColumns = `${width}px minmax(240px,1fr)`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('width',width); svg.setAttribute('height',height); svg.setAttribute('aria-hidden','true');
      const color = lane => `var(--theia-charts-${['blue','green','orange','purple','red','yellow'][lane%6]},var(--theia-focusBorder))`;
      for (const edge of graph.edges) {
        const path = document.createElementNS(svg.namespaceURI,'path'); const x = 14+edge.from*20, to = 14+edge.to*20, y = edge.row*58+29;
        path.setAttribute('d',`M ${x} ${y} C ${x} ${y+29} ${to} ${y+29} ${to} ${y+58}`); path.setAttribute('stroke',color(edge.color)); path.setAttribute('fill','none'); path.setAttribute('stroke-width','2'); svg.append(path);
      }
      const commits = element('div');
      for (const [index,commit] of graph.rows.entries()) {
        const circle = document.createElementNS(svg.namespaceURI,'circle'); circle.setAttribute('cx',14+commit.lane*20); circle.setAttribute('cy',index*58+29); circle.setAttribute('r','4'); circle.setAttribute('fill',color(commit.lane)); svg.append(circle);
        const row = element('div',undefined,'plain-git-graph-row');
        const refs = element('div',undefined,'plain-git-graph-refs');
        for (const ref of commit.refs) {
          const branch = {...ref,commit:commit.id};
          const button = element('button', `${ref.current ? '● ' : ''}${ref.name}${ref.remote ? ' (remote)' : ''}`); button.type = 'button'; refs.append(button);
          button.dataset.gitGraphBranch = ref.name; button.title = `Right-click ${ref.name} for Git actions`; button.setAttribute('aria-haspopup','menu');
          this.bindGitMenu(button,event => this.openBranchMenu(event,branch,button));
        }
        row.append(refs);
        const button = element('button',commit.message || '(No commit message)'); button.type = 'button'; row.append(button); button.dataset.gitGraphCommit=commit.id; button.title = 'Right-click for Git actions';
        this.bindGitMenu(button,event => this.openCommitMenu(event,commit,button));
        row.addEventListener('contextmenu',event => this.openCommitMenu(event,commit,button));
        row.append(element('small',`${commit.id.slice(0,7)} · ${commit.author}`,'plain-git-muted')); commits.append(row);
      }
      layout.append(svg,commits); this.review.append(layout);
      if (!graph.rows.length) this.review.append(element('p','Your first commit will start the graph.','plain-git-review-note'));
      if (result.hasMore) {
        this.review.append(element('p',`Showing the latest ${result.limit} commits across local and remote branches.`,'plain-git-review-note'));
        if (result.limit < 1000) this.button(this.review,'Show 100 more commits',() => {this.graphLimit=result.limit+100;this.renderBranchGraph();});
      }
    } catch (error) { if (generation === this.previewGeneration) this.showReview('Branch graph',error.message); }
  }
  async renderHistory(info) {
    let selected;
    for (const commit of info.history || []) {
      const row = this.button(this.list, '', () => this.selectCommit(commit.id)); row.className = 'plain-git-history-row';
      row.append(element('strong', commit.message.split(/\r?\n/)[0] || '(No commit message)'));
      row.dataset.gitCommit = commit.id;
      this.bindGitMenu(row,event => this.openCommitMenu(event,commit,row));
      if (!selected || commit.id === this.selectedCommit) selected = commit;
      row.append(element('small', `${commit.id.slice(0,7)} · ${commit.author || ''}${commit.date ? ' · '+new Date(commit.date).toLocaleString() : ''}`, 'plain-git-muted')); this.list.append(row);
    }
    if (!info.history?.length) this.list.append(element('p', 'No commits yet.', 'plain-git-muted'));
    if (this.historyOffset) this.button(this.actions, 'Newer commits', () => { this.historyOffset = Math.max(0, this.historyOffset - 20); this.refresh(); });
    if (info.historyHasMore) this.button(this.actions, 'Older commits', () => { this.historyOffset = (this.historyOffset || 0) + 20; this.refresh(); });
    if (selected) await this.selectCommit(selected.id);
  }
  async selectCommit(id, offset = 0) {
    const generation = ++this.previewGeneration; this.selectedCommit = id; this.editingConflict = false;
    for (const button of this.list.querySelectorAll('[data-git-commit]')) button.setAttribute('aria-pressed', String(button.dataset.gitCommit === id));
    this.showReview(id.slice(0, 7), 'Loading changed files…');
    try {
      const details = await this.commands.executeCommand('git.singularityInspect', this.root, 'commit', { commit: id, offset });
      if (this.isDisposed || generation !== this.previewGeneration) return;
      const subject = details.message.split(/\r?\n/)[0] || '(No commit message)';
      this.showReview('', ''); this.review.classList.add('plain-git-history-view'); this.reviewTitle.classList.add('plain-git-history-heading');
      const heading = element('span', `${id.slice(0,7)} · ${subject}`, 'plain-git-history-subject'); heading.title = subject;
      const metadata = element('details', undefined, 'plain-git-commit-metadata');
      const summary = element('summary', 'Details'); summary.setAttribute('aria-label','Commit details');
      const panel = element('div', undefined, 'plain-git-commit-metadata-panel');
      panel.append(element('p', `${details.author || ''}${details.date ? ' · '+new Date(details.date).toLocaleString() : ''}`),
        element('pre', details.message), element('small',`${details.total} changed file(s)${details.parents.length > 1 ? ' · Compared with first parent' : ''}`));
      metadata.append(summary,panel); this.reviewTitle.append(heading,metadata);
      const layout = element('div', undefined, 'plain-git-history-details');
      const files = element('div', undefined, 'plain-git-history-files'), diff = element('div', undefined, 'plain-git-history-diff');
      files.append(element('small', `${details.total} changed file(s)`, 'plain-git-file-count'));
      const splitter = element('div'); splitter.setAttribute('aria-label','Resize modified files and code'); layout.append(files, splitter, diff); this.review.append(layout);
      this.filesSplitter = createGitSplitter(layout,splitter,{variable:'--plain-git-files-width',value:this.filesFraction,minLeft:110,minRight:220,onChange:value=>this.filesFraction=value});
      const root = this.root;
      const selectFile = async file => {
        const fileGeneration = this.historyFileGeneration = (this.historyFileGeneration || 0) + 1;
        for (const button of files.querySelectorAll('[data-git-history-file]')) button.setAttribute('aria-pressed', String(button.dataset.gitHistoryFile === file.path));
        diff.replaceChildren(element('p', 'Loading diff…', 'plain-git-review-note'));
        try {
          const preview = await this.commands.executeCommand('git.singularityInspect', this.root, 'commitPreview', { commit: id, path: file.path, offset });
          if (this.isDisposed || generation !== this.previewGeneration || fileGeneration !== this.historyFileGeneration) return;
          const fileTitle = element('h3', file.path); fileTitle.title = preview.note; diff.replaceChildren(fileTitle);
          if (!preview.text && !preview.canExpand) diff.append(element('p', preview.note, 'plain-git-review-note'));
          this.renderPreview(diff,preview,lineOffset=>this.commands.executeCommand('git.singularityInspect',root,'commitPreview',{commit:id,path:file.path,offset,fullFile:true,lineOffset}));
        } catch (error) { if (generation === this.previewGeneration && fileGeneration === this.historyFileGeneration) diff.replaceChildren(element('p', error.message, 'plain-git-review-note')); }
      };
      for (const file of details.files) {
        const status = { A: 'Added', D: 'Deleted', M: 'Modified', T: 'Type changed' }[file.status] || file.status;
        const button = this.button(files, '', () => selectFile(file)); button.append(element('span',status,'plain-git-file-status'),document.createTextNode(` · ${file.path}`)); button.dataset.gitHistoryFile = file.path; button.dataset.status = file.status; button.title = `${status}: ${file.path}`;
      }
      if (offset) this.button(files, 'Previous files', () => this.selectCommit(id, Math.max(0, offset - 100)));
      if (details.nextOffset !== undefined) this.button(files, 'More files', () => this.selectCommit(id, details.nextOffset));
      if (details.files.length) await selectFile(details.files[0]); else diff.append(element('p', 'This commit has no file changes.', 'plain-git-review-note'));
    } catch (error) { if (generation === this.previewGeneration) this.showReview(id.slice(0, 7), error.message); }
  }
  confirmMerge(branch, head) {
    if (this.blockUnsavedResolution()) return;
    this.previewGeneration++;
    this.editingConflict = false;
    this.showReview(`Merge ${branch.name} → ${head.name}`, 'This brings changes from the selected branch into your current branch. Commit or stash any pending changes first.');
    this.button(this.review, `Merge ${branch.name} into ${head.name}`, () => this.workspaceOperation('merge', { source: branch.name, sourceCommit: branch.commit, target: head.name, targetCommit: head.commit })).dataset.gitConfirmMerge = '';
    this.backToGraph();
  }
  confirmAbortMerge() {
    if (this.blockUnsavedResolution()) return;
    this.previewGeneration++;
    this.editingConflict = false;
    this.showReview('Abort this merge?', 'This discards the merge resolution and restores the branch to its state before the merge.');
    const abort=this.button(this.review, 'Abort merge', () => this.workspaceOperation('abortMerge'));abort.dataset.gitConfirmAbort='';abort.classList.add('plain-git-danger');
  }
  workspaceOperation(action, request) {
    const root = this.root;
    return this.perform(async () => {
      if (action === 'merge' || action === 'resolveConflict') this.assertSavedFiles();
      const result = await this.commands.executeCommand('git.singularityOperation', root, action, request);
      if (action === 'resolveConflict' || action === 'abortMerge') this.setResolutionDirty(false);
      this.editingConflict = false; this.viewKey = undefined;
      if (result?.conflicts || action === 'resolveConflict' || action === 'abortMerge') this.section = 'changes';
      return result;
    },this.confirmation(action,request));
  }
  renderRemotes(info) {
    this.button(this.actions, 'Create GitHub repository…', () => this.showGitHubForm());
    this.button(this.actions, 'Add remote…', () => this.run('git.addRemote'));
    this.button(this.actions, 'Remove remote…', () => this.run('git.removeRemote')).disabled = !info.remotes?.length;
    this.button(this.actions, 'Configure commit identity…', () => this.run('git.singularityConfigureIdentity'));
    for (const remote of info.remotes || []) {
      const row = element('div', undefined, 'plain-git-history-row'); row.append(element('strong', remote.name)); row.append(element('span', remote.fetchUrl || remote.pushUrl || '')); this.list.append(row);
    }
    if (!info.remotes?.length) this.list.append(element('p', 'This repository is local only. You can commit, use branches, and review history without an account. Add a remote only when you want to push or pull changes.', 'plain-git-muted'));
  }
  showGitHubForm() {
    if (this.busy || this.blockUnsavedResolution()) return;
    this.githubForm?.dispose(); this.previewGeneration++; this.closeBranchMenu(); this.toggleMore(false);
    this.section = 'remotes';
    for (const button of this.node.querySelectorAll('[data-git-section]')) button.setAttribute('aria-pressed',String(button.dataset.gitSection==='remotes'));
    this.node.querySelector('.plain-git-empty').hidden = true;
    const content = this.node.querySelector('.plain-git-content'); content.hidden = false; content.dataset.section = 'github';
    this.showReview('Create a GitHub repository', '');
    this.githubForm = createGitHubForm(this);
  }
  closeGitHubForm(refresh = true) {
    if (!this.githubForm) return;
    this.githubForm.dispose(); this.githubForm = undefined; this.viewKey = undefined;
    if (refresh) this.refresh();
  }
  report(error) { this.status.textContent = error.message; this.container.get(MessageService).error(error.message); }
  async commit() {
    if (!this.message.value.trim()) { this.status.textContent = 'Enter a commit message.'; this.message.focus(); return; }
    const repository = this.repository();
    if (!this.info?.merging && !repository?.provider.groups.some(group => group.id === 'index' && group.resources.length)) { this.status.textContent = 'Stage the files you want to commit first.'; return; }
    repository.input.value = this.message.value;
    return this.workspaceOperation('commit', { message: this.message.value });
  }
  runResource(command, resource) {
    return this.perform(()=> {
    const current = this.repository()?.provider.groups.flatMap(group => group.resources)
      .find(item => item.sourceUri.toString() === resource.sourceUri.toString());
    const argument = current && this.container.get(PluginMenuCommandAdapter).toScmArg(current);
    if (!argument) throw new Error('This file changed. Refresh and try again.');
    return this.commands.executeCommand(command, argument);
    },this.confirmation(command,{file:resource.sourceUri.path.toString()}));
  }
  run(command, ...args) {
    const root = this.root;
    if (!root && !['git.init','git.clone'].includes(command)) return;
    if (REMOTE_COMMANDS.has(command) && this.info?.remoteCount === 0) {
      this.status.textContent = 'This repository is local only. Add a remote in Remotes when you want to push or pull.'; return;
    }
    // Bundled Git's true argument initializes the open folder directly; with
    // multiple workspace folders it still asks which folder to initialize.
    const commandArgs = command === 'git.init' ? [true, ...args] : command === 'git.clone' ? args : [new URI(root).codeUri, ...args];
    return this.perform(() => this.commands.executeCommand(command, ...commandArgs),this.confirmation(command));
  }
  confirmation(command,context) {
    return gitConfirmation(command,{repository:this.root?new URI(this.root).path.toString():undefined,branch:this.info?.head?.name,merging:this.info?.merging,...context});
  }
  async perform(action,confirmation) {
    if (this.busy) return;
    const root=this.root;let executed=false;
    this.notice = undefined; this.busy = true; this.select.disabled = true; this.node.setAttribute('aria-busy', 'true'); this.status.textContent = 'Working…'; this.generation++;
    try {
      if(confirmation) {
        const message=element('div',confirmation.msg);message.style.whiteSpace='pre-line';
        const dialog=new ConfirmDialog({...confirmation,msg:message});dialog.addClass('plain-git-confirmation');
        if(/^(Abort|Discard|Delete|Drop|Force)/.test(confirmation.ok))dialog.addClass('plain-git-danger-confirmation');
        if(!await dialog.open())return;
      }
      if(this.isDisposed)return;
      if(confirmation && root!==this.root)throw new Error('The repository changed. Review the action again.');
      executed=true;const result = await action(); if (result?.message && !result.conflicts) this.notice = result.message; return result;
    }
    catch (error) { this.notice = error.message; }
    finally {
      this.busy = false; this.select.disabled = false; this.node.removeAttribute('aria-busy'); if (this.isDisposed) return;
      if(executed)await this.refresh();else this.status.textContent=this.notice||'';
      if (this.githubForm) this.status.textContent = this.notice || '';
      if (this.notice) this.status.textContent = this.notice;
    }
  }
}

module.exports = { GitWidget };
