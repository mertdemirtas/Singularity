'use strict';
const { BaseWidget } = require('@theia/core/lib/browser/widgets/widget');
const ID = 'plain-editor.welcome';

function createWelcome(icon) {
  const widget = new BaseWidget();
  widget.id = ID;
  widget.title.label = 'Welcome';
  widget.title.caption = 'Welcome to Plain Editor';
  widget.title.iconClass = 'codicon codicon-home';
  widget.title.closable = true;
  widget.addClass('plain-welcome');
  widget.node.tabIndex = 0;
  widget.onActivateRequest = message => { BaseWidget.prototype.onActivateRequest.call(widget, message); widget.node.focus(); };
  widget.storeState = () => ({});
  widget.restoreState = () => {};
  widget.node.innerHTML = `<div class="plain-welcome-content">
    <header><h1>Plain Editor</h1><p>A quiet place for notes and code.</p></header>
    <div class="plain-welcome-columns">
      <section><h2>Start</h2>
        <button type="button" data-welcome-action="open-file">${icon('document')}<span>Open a file</span><kbd>Ctrl+O</kbd></button>
        <button type="button" data-welcome-action="open-folder">${icon('folder')}<span>Open a folder</span></button>
        <button type="button" data-welcome-action="new">${icon('add')}<span>New file</span><kbd>Ctrl+N</kbd></button>
      </section>
      <section><h2>Recent files</h2><div class="plain-welcome-recent"><p>No recent files yet.</p></div></section>
    </div>
    <footer><button type="button" data-welcome-action="settings">Settings</button><span>Theme, font, and editing preferences</span></footer>
  </div>`;
  widget.node.addEventListener('click', event => {
    const control = event.target.closest('[data-welcome-action], [data-welcome-uri]');
    if (control) window.dispatchEvent(new CustomEvent('plain-welcome-action', {
      detail: { action: control.dataset.welcomeAction, uri: control.dataset.welcomeUri }
    }));
  });
  window.plainEditorDesktop?.recentFiles().then(entries => {
    if (widget.isDisposed || !entries.length) return;
    const list = widget.node.querySelector('.plain-welcome-recent');
    list.replaceChildren();
    for (const entry of entries.slice(0, 5)) {
      const control = document.createElement('button');
      control.type = 'button';
      control.dataset.welcomeUri = entry.uri;
      control.title = `${entry.folder}/${entry.name}`;
      const name = document.createElement('span');
      name.textContent = entry.name;
      const folder = document.createElement('small');
      folder.textContent = entry.folder;
      control.append(name, folder);
      list.append(control);
    }
  }).catch(error => console.error('Plain Editor: welcome recent files', error));
  return widget;
}
module.exports = { ID, createWelcome };
