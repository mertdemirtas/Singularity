'use strict';
const { BaseWidget } = require('@theia/core/lib/browser/widgets/widget');
const { WidgetFactory, WidgetManager } = require('@theia/core/lib/browser/widget-manager');
const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
const { CommandContribution } = require('@theia/core/lib/common/command');
const { PreferenceContribution } = require('@theia/core/lib/common/preferences/preference-schema');
const { PreferenceService } = require('@theia/core/lib/common/preferences/preference-service');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { WorkspaceService } = require('@theia/workspace/lib/browser/workspace-service');
const { WorkspaceTrustService } = require('@theia/workspace/lib/browser/workspace-trust-service');
const { TerminalService } = require('@theia/terminal/lib/browser/base/terminal-service');
const { BrowserWidget, FACTORY: BROWSER } = require('./browser-widget');
const FACTORY = 'plain-editor.development';
const shellQuote = text => `'${String(text).replace(/'/g, `'\\''`)}'`;

class DevelopmentWidget extends BaseWidget {
  constructor(controller) {
    super();
    this.id = FACTORY; this.title.label = 'Development'; this.title.iconClass = 'codicon codicon-tools'; this.title.closable = true;
    this.addClass('plain-development');
    this.node.tabIndex = 0;
    this.node.innerHTML = `<div class="plain-development-content"><h1>Development</h1>
      <p>Preview web apps, run a server, and work with coding assistants.</p>
      <section><h2>Browser and local server</h2>
        <label>Preview address<input data-tool-field="url" value="http://localhost:3000" spellcheck="false"></label>
        <div class="plain-tool-actions"><button data-tool-action="browser">Open browser</button><button data-tool-action="git">Source Control</button></div>
        <label>Server command<input data-tool-field="server" value="npm run dev" spellcheck="false"></label>
        <button data-tool-action="server">Start server in terminal</button><small>Runs in the open folder. Hide the terminal to keep the server running; Ctrl+C stops it.</small>
      </section>
      <section><h2>Coding assistants</h2><p>Use your installed CLI and its own sign-in. Commands run in the open project folder.</p>
        <div class="plain-tool-actions"><button data-tool-action="codex">Start Codex</button><button data-tool-action="claude">Start Claude Code</button></div>
        <small>CLI commands can be customized in All settings: plainEditor.ai.codexCommand and plainEditor.ai.claudeCommand.</small>
      </section>
      <section><h2>Remote SSH</h2><p>Open a terminal and type <code>ssh user@host</code>. Sign in there; the device’s files appear automatically in Files.</p>
        <button data-tool-action="ssh-terminal">Open terminal</button></section><div class="plain-tool-status" role="status"></div></div>`;
    this.status = this.node.querySelector('.plain-tool-status');
    this.node.addEventListener('click', async event => {
      const button = event.target.closest('[data-tool-action]');
      if (!button) return;
      button.disabled = true;
      this.status.textContent = '';
      const value = field => this.node.querySelector(`[data-tool-field="${field}"]`).value.trim();
      try {
        switch (button.dataset.toolAction) {
          case 'browser': await controller.openBrowser(value('url')); break;
          case 'git': await controller.openGit(); break;
          case 'server':
            if (!value('server')) throw new Error('Enter a server command.');
            await controller.launch('Development server', value('server')); break;
          case 'codex': case 'claude': await controller.launchAI(button.dataset.toolAction); break;
          case 'ssh-terminal': await controller.openTerminal(); break;
        }
      } catch (error) { this.status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  storeState() { return Object.fromEntries([...this.node.querySelectorAll('[data-tool-field]')].map(input => [input.dataset.toolField, input.value])); }
  onActivateRequest(message) { super.onActivateRequest(message); this.node.focus(); }
  restoreState(state) {
    for (const input of this.node.querySelectorAll('[data-tool-field]')) if (typeof state[input.dataset.toolField] === 'string') input.value = state[input.dataset.toolField];
  }
}

module.exports = function installDevelopmentTools(bind) {
  const Controller = Symbol('PlainDevelopmentController');
  bind(PreferenceContribution).toConstantValue({ schema: { type: 'object', properties: {
    'plainEditor.ai.codexCommand': { type: 'string', default: 'codex', description: 'Command to start the Codex CLI in a project terminal.' },
    'plainEditor.ai.claudeCommand': { type: 'string', default: 'claude', description: 'Command to start Claude Code in a project terminal.' }
  } } });
  bind(Controller).toDynamicValue(({ container }) => {
    const shell = container.get(ApplicationShell), widgets = container.get(WidgetManager);
    const workspace = container.get(WorkspaceService), terminals = container.get(TerminalService);
    const trust = container.get(WorkspaceTrustService), preferences = container.get(PreferenceService);
    const sessions = new Map();
    return {
      async openBrowser(url) {
        const widget = await widgets.getOrCreateWidget(BROWSER, { id: crypto.randomUUID() });
        await shell.addWidget(widget, { area: 'main' });
        await shell.activateWidget(widget.id);
        if (url) await widget.navigate(url);
        return widget;
      },
      async openTools() {
        const widget = await widgets.getOrCreateWidget(FACTORY);
        if (!widget.isAttached) await shell.addWidget(widget, { area: 'main' });
        await shell.activateWidget(widget.id);
        return widget;
      },
      async openTerminal() { return container.get(require('@theia/core/lib/common/command').CommandRegistry).executeCommand('terminal:new'); },
      async openGit() { window.dispatchEvent(new Event('plain-open-source-control')); },
      async launch(title, command) {
        const [root] = await workspace.roots;
        if (!root || root.resource.scheme !== 'file') throw new Error('Open a local project folder first.');
        if (!await trust.requestWorkspaceTrust()) throw new Error('Trust the project folder before running commands.');
        const key = `${root.resource}:${title}`;
        let terminal = sessions.get(key);
        if (terminal && !terminal.isDisposed && !terminal.exitStatus) {
          await terminals.open(terminal, { mode: 'activate' });
          return terminal;
        }
        terminal = await terminals.newTerminal({ title, cwd: root.resource.toString(), useServerTitle: false, destroyTermOnClose: true });
        sessions.set(key, terminal);
        try {
          await terminal.start();
          await terminals.open(terminal, { mode: 'activate' });
          terminal.sendText(`${command}\r`);
          return terminal;
        } catch (error) { sessions.delete(key); terminal.dispose(); throw error; }
      },
      async launchAI(tool) {
        const command = preferences.get(`plainEditor.ai.${tool}Command`, tool).trim();
        if (!command) throw new Error('Configure the assistant command in All settings first.');
        return this.launch(tool === 'codex' ? 'Codex' : 'Claude Code', command);
      }
    };
  }).inSingletonScope();
  bind(WidgetFactory).toConstantValue({ id: BROWSER, createWidget: options => new BrowserWidget(options) });
  bind(WidgetFactory).toDynamicValue(({ container }) => ({ id: FACTORY, createWidget: () => new DevelopmentWidget(container.get(Controller)) }));
  bind(CommandContribution).toDynamicValue(({ container }) => ({ registerCommands(registry) {
    const controller = container.get(Controller), messages = container.get(MessageService);
    for (const [id, label, action] of [
      ['browser', 'Open Browser', () => controller.openBrowser()],
      ['development', 'Development Tools', () => controller.openTools()],
      ['codex', 'Start Codex', () => controller.launchAI('codex')],
      ['claude', 'Start Claude Code', () => controller.launchAI('claude')]
    ]) registry.registerCommand({ id: `plain-editor.${id}`, category: 'Singularity', label }, {
      execute: () => action().catch(error => messages.error(error.message))
    });
  } }));
};
module.exports.shellQuote = shellQuote;
