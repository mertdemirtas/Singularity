'use strict';

const { CommandContribution } = require('@theia/core/lib/common/command');
const { MessageService } = require('@theia/core/lib/common/message-service');
const { Emitter } = require('@theia/core/lib/common/event');
const { ApplicationShell } = require('@theia/core/lib/browser/shell/application-shell');
const { WorkspaceService } = require('@theia/workspace/lib/browser/workspace-service');
const { TabBarToolbarContribution } = require('@theia/core/lib/browser/shell/tab-bar-toolbar');
const URI = require('@theia/core/lib/common/uri').default;

const COMMAND = { id: 'plain-editor.export-pdf', label: 'Export PDF', category: 'File', iconClass: 'codicon codicon-file-pdf' };
const markdownPreview = widget => ['markdown.preview', 'vscode.markdown.preview.editor'].includes(widget?.viewType);
const textModel = widget => {
  const model = widget?.editor?.getControl?.()?.getModel?.();
  return typeof model?.getValue === 'function' ? model : undefined;
};

async function openMarkdownPreview(shell, registry, resource) {
  await registry.executeCommand('markdown.showPreview', resource.codeUri);
  const parsed = new Map();
  const deadline = Date.now() + 30000;
  do {
    for (const widget of shell.mainPanel.widgets()) {
      if (!markdownPreview(widget)) continue;
      if (widget.resource?.toString() === resource.toString()) return widget;
      if (parsed.get(widget)?.html !== widget.html) {
        const document = new DOMParser().parseFromString(widget.html || '', 'text/html');
        const data = document.getElementById('vscode-markdown-preview-data');
        parsed.set(widget, { html: widget.html, source: data && JSON.parse(data.dataset.settings).source });
      }
      const source = parsed.get(widget)?.source;
      if (source && new URI(source).toString() === resource.toString()) return widget;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('The Markdown preview could not be opened. Try opening it before exporting.');
}

module.exports = bind => {
  let busy = false;
  const changed = new Emitter();
  const visible = widget => Boolean(window.plainEditorDesktop?.exportPdf && (markdownPreview(widget) || textModel(widget)));
  bind(CommandContribution).toDynamicValue(({ container }) => ({ registerCommands(registry) {
    registry.registerCommand(COMMAND, {
      isEnabled: widget => !busy && visible(widget || container.get(ApplicationShell).currentWidget),
      execute: async widget => {
        widget ||= container.get(ApplicationShell).currentWidget;
        if (busy || !visible(widget)) return;
        busy = true; changed.fire();
        let progress;
        try {
          progress = await container.get(MessageService).showProgress({ text: 'Exporting PDF…' });
          // Markdown source exports the rendered preview, including unsaved edits.
          if (!markdownPreview(widget) && ['.md', '.markdown'].includes(widget.editor.uri.path.ext.toLowerCase())) {
            widget = await openMarkdownPreview(container.get(ApplicationShell), registry, widget.editor.uri);
            await widget.ready.promise;
          }
          const folders = (await container.get(WorkspaceService).roots).map(root => root.resource.toString());
          const model = textModel(widget);
          if (model?.getValueLength() > 20 * 1024 * 1024) throw new Error('Text PDF export supports files up to 20 MB.');
          const request = markdownPreview(widget) ? { kind: 'markdown', id: widget.identifier.id }
            : { kind: 'text', source: widget.editor.uri.toString(), name: widget.title.label, text: model.getValue(), fontFamily: widget.editor.getControl().getRawOptions().fontFamily };
          const result = await window.plainEditorDesktop.exportPdf({ ...request, folders });
          if (result?.path) container.get(MessageService).info(`PDF saved: ${result.path}`);
        } catch (error) { container.get(MessageService).error(`Could not export PDF: ${error.message}`); }
        finally { progress?.cancel(); busy = false; changed.fire(); }
      }
    });
  } }));
  bind(TabBarToolbarContribution).toConstantValue({ registerToolbarItems(registry) {
    registry.registerItem({ id: COMMAND.id, command: COMMAND.id, icon: COMMAND.iconClass, tooltip: 'Export PDF', group: 'navigation', priority: 1,
      isVisible: visible, onDidChange: changed.event });
  } });
};
