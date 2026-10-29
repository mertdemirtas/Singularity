'use strict';
const { CommandContribution } = require('@theia/core/lib/common/command');
const { TabBarToolbarContribution } = require('@theia/core/lib/browser/shell/tab-bar-toolbar');
const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
const { ConfirmDialog } = require('@theia/core/lib/browser/dialogs');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { TerminalService } = require('@theia/terminal/lib/browser/base/terminal-service');
const { TerminalWidget } = require('@theia/terminal/lib/browser/base/terminal-widget');
const { Emitter } = require('@theia/core/lib/common/event');
const { closeTerminals } = require('./terminal-panel-actions.cjs');
module.exports = bind => {
  let closing = false;
  const changed = new Emitter();
  const commands = [
    { id: 'plain-editor.terminal-minimize', label: 'Minimize terminal panel', iconClass: 'codicon codicon-chevron-down', priority: 110 },
    { id: 'plain-editor.terminal-close-all', label: 'Close all terminals', iconClass: 'codicon codicon-close-all', priority: 120 }
  ];
  bind(CommandContribution).toDynamicValue(({ container }) => ({ registerCommands(registry) {
    const shell = container.get(ApplicationShell), terminals = container.get(TerminalService);
    registry.registerCommand(commands[0], { execute: () => shell.collapsePanel('bottom'), isEnabled: () => shell.isExpanded('bottom') });
    registry.registerCommand(commands[1], {
      isEnabled: () => !closing && terminals.all.length > 0,
      execute: async () => {
        if (closing) return;
        closing = true; changed.fire();
        try {
          await closeTerminals([...terminals.all], {
            confirm: count => new ConfirmDialog({ title: 'Close all terminals?', msg: `Close ${count} terminal${count === 1 ? '' : 's'}? Running commands will stop.`, ok: 'Close all', cancel: 'Cancel' }).open(),
            close: id => shell.closeWidget(id)
          });
          if (!terminals.all.length) await shell.collapsePanel('bottom');
        } catch (error) { container.get(MessageService).error(`Could not close terminals: ${error.message}`); }
        finally { closing = false; changed.fire(); }
      }
    });
  } }));
  bind(TabBarToolbarContribution).toDynamicValue(({ container }) => ({ registerToolbarItems(registry) {
    const shell = container.get(ApplicationShell);
    for (const command of commands) registry.registerItem({ id: command.id, command: command.id, tooltip: command.label,
      icon: command.iconClass, priority: command.priority, onDidChange: changed.event,
      isVisible: widget => widget instanceof TerminalWidget && shell.getAreaFor(widget) === 'bottom'
    });
  } }));
};
