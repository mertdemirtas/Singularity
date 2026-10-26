'use strict';
const { OS } = require('@theia/core/lib/common/os');
const URI = require('@theia/core/lib/common/uri').default;
const { Emitter } = require('@theia/core/lib/common/event');
const { CommandContribution } = require('@theia/core/lib/common/command');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { QuickPickService } = require('@theia/core/lib/common/quick-pick-service');
const { WebSocketConnectionProvider } = require('@theia/core/lib/browser/messaging/ws-connection-provider');
const { FrontendApplicationContribution } = require('@theia/core/lib/browser/frontend-application-contribution');
const { ConfirmDialog } = require('@theia/core/lib/browser/dialogs');
const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
const { LabelProviderContribution } = require('@theia/core/lib/browser/label-provider');
const { FileServiceContribution } = require('@theia/filesystem/lib/browser/file-service');
const { RemoteFileSystemProvider, RemoteFileSystemProxyFactory } = require('@theia/filesystem/lib/common/remote-file-system-provider');
const { WorkspaceService } = require('@theia/workspace/lib/browser/workspace-service');
const { WidgetManager } = require('@theia/core/lib/browser/widget-manager');
const { WorkspaceStorageService } = require('@theia/workspace/lib/browser/workspace-storage-service');
const { EditorManager } = require('@theia/editor/lib/browser/editor-manager');
const { SSH_PATH, SSH_CONTROLLER, REMOTE_VIEW } = require('./ssh-protocol');
module.exports = bind => {
  require('./ssh-navigator')(bind);
  const { WorkspaceData } = require('@theia/workspace/lib/browser/workspace-service');
  const { preserveSshFolders } = require('./ssh-workspace.cjs');
  for (const method of ['transformToRelative', 'transformToAbsolute']) WorkspaceData[method] = preserveSshFolders(WorkspaceData[method]);
  bind(SSH_CONTROLLER).toDynamicValue(({ container }) => {
    const shell = () => container.get(ApplicationShell), workspace = () => container.get(WorkspaceService), editors = () => container.get(EditorManager);
    const factory = new RemoteFileSystemProxyFactory(), changes = new Emitter();
    const server = WebSocketConnectionProvider.createProxy(container, SSH_PATH, factory);
    const pendingEditors = new Map();
    const storage = () => container.get(WorkspaceStorageService);
    const savePending = () => storage().setData('singularity.ssh.pendingEditors', [...pendingEditors]);
    const controller = {
      server, profiles: [], changes,
      async refresh() { this.profiles = await server.listConnections(); changes.fire({ affects: value => (value instanceof URI ? value : value?.resource)?.scheme === 'ssh' }); return this.profiles; },
      async openFolder(value) {
        await this.refresh();
        const uri = new URI().withScheme('ssh').withAuthority(value.id).withPath(value.folder);
        const service = workspace(), createsWorkspace = !service.workspace || service.workspace.isDirectory;
        await service.addRoot(uri);
        // Attaching a device should persist with the session without asking the
        // user to name an automatically created multi-folder workspace on exit.
        if (createsWorkspace && service.isUntitledWorkspace(service.workspace?.resource)) {
          const file = service.workspace.resource;
          await service.save(file.parent.resolve(`SSH-${value.id}-${Date.now()}.theia-workspace`));
        }
        const navigator = await container.get(WidgetManager).getOrCreateWidget(REMOTE_VIEW);
        await navigator.model.updateRoot();
        await navigator.model.revealFile(uri);
        window.dispatchEvent(new Event('plain-open-remote'));
        for (const [address, options] of pendingEditors) if (new URI(address).authority === value.id) {
          await editors().open(new URI(address), { ...options, mode: 'reveal' });
          pendingEditors.delete(address);
          await savePending();
        }
      },
      checkDirty(id) {
        if (editors().all.some(widget => widget.editor.uri.scheme === 'ssh' && widget.editor.uri.authority === id && widget.saveable?.dirty)) throw Error('Save or close unsaved remote files before disconnecting or forgetting this connection.');
      },
      async choose(forget) {
        const profiles = await this.refresh(), candidates = forget ? profiles : profiles.filter(value => value.connected);
        if (!candidates.length) { container.get(MessageService).info(forget ? 'No saved SSH connections.' : 'No connected SSH devices. Type ssh user@host in the terminal to connect.'); return; }
        const id = await container.get(QuickPickService).show(candidates.map(value => ({ label: value.name, description: `${value.username}@${value.host}:${value.port}`, value: value.id })), { placeholder: forget ? 'Forget SSH connection' : 'Disconnect SSH device' });
        if (!id) return; this.checkDirty(id);
        if (forget) {
          if (!await new ConfirmDialog({ title: 'Forget SSH connection', msg: 'Forget this connection and its trusted host key? Remote files will not be deleted.', ok: 'Forget', cancel: 'Cancel' }).open()) return;
          for (const widget of editors().all.filter(widget => widget.editor.uri.scheme === 'ssh' && widget.editor.uri.authority === id)) await shell().closeWidget(widget.id);
          const roots = (await workspace().roots).filter(root => root.resource.scheme === 'ssh' && root.resource.authority === id).map(root => root.resource);
          if (roots.length) await workspace().removeRoots(roots);
          await server.forget(id);
          for (const address of pendingEditors.keys()) if (new URI(address).authority === id) pendingEditors.delete(address);
          await savePending();
        } else await server.disconnect(id);
        await this.refresh();
      },
      registerFiles(service) {
        const provider = new RemoteFileSystemProvider(); provider.server = server; provider.init();
        server.setClient({ ...factory.target,
          remoteConnected: value => this.openFolder(value),
          connectionChanged: () => this.refresh()
        });
        const ready = Promise.all([provider.ready, this.refresh()]).then(() => service.registerProvider('ssh', provider));
        service.onWillActivateFileSystemProvider(event => { if (event.scheme === 'ssh') event.waitUntil(ready); });
      },
      async installTerminal() {
        const { TerminalWidgetImpl } = require('@theia/terminal/lib/browser/terminal-widget-impl');
        const original = TerminalWidgetImpl.prototype.createTerminal;
        TerminalWidgetImpl.prototype.createTerminal = async function () {
          if (this.options.isPseudoTerminal || this.kind !== 'user') return original.call(this);
          const connection = await server.terminalEnvironment();
          const shellPath = this.options.shellPath || this.shellPreferences.shell[OS.backend.type()] || connection.shell;
          this.options = { ...this.options, env: require('./ssh-shell.cjs').terminalEnvironment(this.options.env, connection, shellPath) };
          return original.call(this);
        };
        for (const [address, options] of await storage().getData('singularity.ssh.pendingEditors', [])) pendingEditors.set(address, options);
        // Layout restoration calls WidgetManager directly, bypassing EditorManager.
        // Remember unavailable remote tabs until the user reconnects, including
        // across another offline restart. Never prompt for SSH during startup.
        const manager = container.get(WidgetManager), create = manager.getOrCreateWidget;
        manager.getOrCreateWidget = function (factory, options) {
          return create.call(this, factory, options).catch(async error => {
            if (['code-editor-opener', 'editor-preview-widget'].includes(factory) && options?.uri?.startsWith('ssh://')) {
              const uri = new URI(options.uri);
              if (!controller.profiles.some(value => value.id === uri.authority && value.connected)) {
                pendingEditors.set(uri.toString(), { counter: options.counter, preview: options.preview });
                await savePending();
              }
            }
            throw error;
          });
        };
      }
    };
    return controller;
  }).inSingletonScope();
  bind(FileServiceContribution).toDynamicValue(({ container }) => ({ registerFileSystemProviders: service => container.get(SSH_CONTROLLER).registerFiles(service) }));
  bind(FrontendApplicationContribution).toDynamicValue(({ container }) => ({ onStart() { return container.get(SSH_CONTROLLER).installTerminal(); } }));
  bind(CommandContribution).toDynamicValue(({ container }) => ({ registerCommands(registry) {
    for (const [id, label, forget] of [['disconnect-ssh', 'Disconnect SSH', false], ['forget-ssh', 'Forget SSH Connection', true]]) registry.registerCommand({ id: `plain-editor.${id}`, category: 'Singularity', label }, {
      execute: () => container.get(SSH_CONTROLLER).choose(forget).catch(error => container.get(MessageService).error(error.message))
    });
  } }));
  bind(LabelProviderContribution).toDynamicValue(({ container }) => {
    const controller = container.get(SSH_CONTROLLER);
    const resource = value => value instanceof URI ? value : value?.resource;
    return {
      onDidChange: controller.changes.event,
      canHandle: value => resource(value)?.scheme === 'ssh' ? 100 : 0,
      getName: input => { const uri = resource(input); const value = controller.profiles.find(value => value.id === uri.authority); return value?.folder === uri.path.toString() ? `${uri.path.base || '/'} [SSH: ${value.host}${value.connected ? '' : ' · offline'}]` : uri.path.base; },
      getLongName: input => { const uri = resource(input); const value = controller.profiles.find(value => value.id === uri.authority); return `${uri.path} — SSH: ${value ? value.username + '@' + value.host : 'remote device'}`; }
    };
  });
};
