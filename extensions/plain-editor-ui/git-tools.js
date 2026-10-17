'use strict';

const { CommandContribution, CommandRegistry } = require('@theia/core/lib/common/command');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { MenuContribution } = require('@theia/core/lib/common/menu');
const URI = require('@theia/core/lib/common/uri').default;
const { codicon, ApplicationShell, WidgetFactory, WidgetManager } = require('@theia/core/lib/browser');
const { TabBarToolbarContribution } = require('@theia/core/lib/browser/shell/tab-bar-toolbar');
const { ScmService } = require('@theia/scm/lib/browser/scm-service');
const { SCM_TITLE_MENU } = require('@theia/scm/lib/browser/scm-repositories-widget');
const { MergeEditor } = require('@theia/scm/lib/browser/merge-editor/merge-editor');
const { PluginMenuCommandAdapter } = require('@theia/plugin-ext/lib/main/browser/menus/plugin-menu-command-adapter');
const { EDITOR_CONTENT_MENU } = require('@theia/editor/lib/browser/editor-menu');
const { GitWidget } = require('./git-widget');

const IDENTITY = { id: 'plain-editor.git-identity', category: 'Git', label: 'Configure Commit Identity…', iconClass: codicon('account') };
const ACTIONS = { id: 'plain-editor.git-actions', category: 'Git', label: 'Git Actions', iconClass: codicon('git-branch') };

module.exports = bind => {
  bind(WidgetFactory).toDynamicValue(({ container }) => ({ id: 'plain-git',
    createWidget: () => new GitWidget(container, container.get(CommandRegistry))
  }));
  bind(CommandContribution).toDynamicValue(({ container }) => ({ registerCommands(registry) {
    registry.registerCommand(ACTIONS, { execute: async section => {
      const widget = await container.get(WidgetManager).getOrCreateWidget('plain-git');
      const shell = container.get(ApplicationShell);
      if (!widget.isAttached) shell.addWidget(widget, { area: 'main' });
      if (shell.leftPanelHandler.tabBar.currentTitle?.owner.id === 'scm-view-container' && shell.isExpanded('left')) await shell.collapsePanel('left');
      await shell.activateWidget(widget.id);
      if (['changes', 'branches', 'history', 'remotes'].includes(section)) widget.section = section;
      return widget.open();
    } });
    registry.registerCommand({ id: 'plain-editor.abort-merge' }, {
      execute: () => {
        const root = container.get(ScmService).selectedRepository?.provider.rootUri;
        return registry.executeCommand('git.mergeAbort', root ? new URI(root).codeUri : undefined)
          .catch(error => container.get(MessageService).error(error.message));
      }
    });
    registry.registerCommand({ id: 'plain-editor.complete-merge' }, {
      execute: async widget => {
        try {
          let editor = widget || container.get(ApplicationShell).currentWidget;
          while (editor && !(editor instanceof MergeEditor)) editor = editor.parent;
          if (!editor) return;
          const resultUri = editor.resultUri;
          // git.acceptMerge requires Monaco's scoped focus keys, which cease
          // matching when its toolbar is clicked. Use the native merge editor
          // completion directly, then stage that exact result through Git.
          const result = await registry.executeCommand('mergeEditor.acceptMerge', editor);
          if (result?.successful) {
            const repository = container.get(ScmService).findRepository(resultUri);
            const resource = repository?.provider.groups.flatMap(group => group.resources)
              .find(item => item.sourceUri.toString() === resultUri.toString());
            const argument = resource && container.get(PluginMenuCommandAdapter).toScmArg(resource);
            if (!argument) throw new Error('The resolved file was saved. Refresh Source Control and stage it to finish the merge.');
            await registry.executeCommand('git.stage', argument);
            await registry.executeCommand(ACTIONS.id, 'changes');
          }
        } catch (error) { await container.get(MessageService).error(error.message); }
      }
    });
    registry.registerCommand({ id: 'plain-editor.git-menu' }, {
      execute: async () => {
        await registry.executeCommand(ACTIONS.id);
        container.get(WidgetManager).tryGetWidget('plain-git')?.toggleMore(true);
      }
    });
    registry.registerCommand(IDENTITY, {
      execute: async () => {
        try {
          const repository = container.get(ScmService).selectedRepository;
          const uri = repository?.provider.id === 'git' ? repository.provider.rootUri : undefined;
          await registry.executeCommand('git.singularityConfigureIdentity', uri);
        } catch (error) { await container.get(MessageService).error(error.message); }
      }
    });
  } }));
  bind(MenuContribution).toConstantValue({ registerMenus(menus) {
    menus.registerMenuAction([...EDITOR_CONTENT_MENU, 'navigation'], {
      commandId: 'plain-editor.complete-merge', label: 'Complete Merge', order: '-100',
      when: 'isMergeResultEditor && mergeEditorResultUri in git.mergeChanges'
    });
    menus.registerMenuAction([...SCM_TITLE_MENU, '0_merge'], {
      commandId: 'plain-editor.abort-merge', label: 'Abort Merge', when: 'gitMergeInProgress'
    });
  } });
  bind(TabBarToolbarContribution).toDynamicValue(({ container }) => ({ registerToolbarItems(registry) {
    // With Changes and Graph both present, Theia delegates the top toolbar to
    // the container instead of ScmWidget. Keep the extension's full Git menu
    // reachable there, including Pull/Push, branches, merges, remotes and stash.
    registry.registerItem({ id: ACTIONS.id, command: ACTIONS.id,
      tooltip: 'Git actions', group: 'navigation', priority: -20,
      isVisible: widget => ['scm-view', 'scm-view-container'].includes(widget?.id) && container.get(ScmService).selectedRepository?.provider.id === 'git'
    });
    registry.registerItem({ id: IDENTITY.id, command: IDENTITY.id, tooltip: IDENTITY.label, group: 'navigation', priority: -10,
      isVisible: widget => ['scm-view', 'scm-view-container'].includes(widget?.id) && container.get(ScmService).selectedRepository?.provider.id === 'git'
    });
  } }));
};
