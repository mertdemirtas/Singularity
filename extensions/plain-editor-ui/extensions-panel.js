'use strict';

const React = require('@theia/core/shared/react');
const { decorate, injectable, inject } = require('@theia/core/shared/inversify');
const { Emitter } = require('@theia/core/lib/common/event');
const { FrontendApplicationContribution } = require('@theia/core/lib/browser/frontend-application-contribution');
const { WidgetFactory, WidgetManager } = require('@theia/core/lib/browser/widget-manager');
const { ViewContainerIdentifier } = require('@theia/core/lib/browser/view-container');
const { SourceTreeWidget } = require('@theia/core/lib/browser/source-tree');
const { PreferenceService } = require('@theia/core/lib/common/preferences/preference-service');
const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
const { ApplicationServer } = require('@theia/core/lib/common/application-protocol');
const { OVSXApiFilterProvider } = require('@theia/ovsx-client');
const { VSXRegistryService } = require('@theia/vsx-registry/lib/common/vsx-registry-service');
const { VSXExtensionsModel } = require('@theia/vsx-registry/lib/browser/vsx-extensions-model');
const { VSXExtensionFactory, VSXExtensionComponent } = require('@theia/vsx-registry/lib/browser/vsx-extension');
const { VSXExtensionsSource, VSXExtensionsSourceOptions } = require('@theia/vsx-registry/lib/browser/vsx-extensions-source');
const { VSXExtensionsWidget, VSXExtensionsWidgetOptions } = require('@theia/vsx-registry/lib/browser/vsx-extensions-widget');
const { VSXExtensionsSearchBar } = require('@theia/vsx-registry/lib/browser/vsx-extensions-search-bar');
const { VSXExtensionsViewContainer } = require('@theia/vsx-registry/lib/browser/vsx-extensions-view-container');
const { ExtensionCatalog, filterAndSort, configurationProperties } = require('./extension-catalog');

const Catalog = Symbol('PlainExtensionCatalog');
const h = React.createElement;
const scopes = [['all', 'All extensions'], ['recommended', 'Recommended'], ['installed', 'Installed'], ['enabled', 'Enabled'], ['disabled', 'Disabled'], ['builtin', 'Built-in']];
const sorts = [['downloadCount', 'Most downloaded'], ['averageRating', 'Top rated'], ['name', 'Name A–Z']];

class PlainExtensionsSearchBar extends VSXExtensionsSearchBar {
  init() {
    super.init();
    this.toDispose.push(this.catalog.onDidChange(() => this.update()));
  }

  updateSearchTerm() {
    this.catalog.syncScope();
    super.updateSearchTerm(this.searchModel.parseQuery().freeText);
  }

  render() {
    const { catalog } = this;
    const showRecommendations = ['all', 'recommended'].includes(catalog.scope) && !this.searchModel.parseQuery().freeText;
    const verified = this.preferenceService.get('extensions.onlyShowVerifiedExtensions', false);
    return h('div', { className: 'plain-extensions-controls' },
      h('div', { className: 'vsx-search-container' },
        h('input', {
          ref: input => { this.input = input || undefined; }, type: 'search', className: 'theia-input',
          placeholder: 'Search extensions', 'aria-label': 'Search extensions', spellCheck: false,
          value: this.searchModel.parseQuery().freeText, onChange: event => catalog.setQuery(event.target.value)
        }),
        h('button', {
          type: 'button', className: `plain-extension-icon codicon codicon-verified${verified ? ' enabled' : ''}`,
          title: 'Show only verified extensions', 'aria-label': 'Show only verified extensions', 'aria-pressed': verified,
          onClick: () => this.preferenceService.set('extensions.onlyShowVerifiedExtensions', !verified, PreferenceScope.User)
            .catch(error => console.error('Singularity: extension filter', error))
        })
      ),
      h('div', { className: 'plain-extensions-filters' },
        h('select', { 'aria-label': 'Filter extensions', value: catalog.scope, onChange: event => catalog.setScope(event.target.value) },
          scopes.map(([value, label]) => h('option', { key: value, value }, label))),
        h('select', { 'aria-label': 'Sort extensions', value: catalog.sort, onChange: event => { catalog.sort = event.target.value; catalog.notify('filters'); } },
          sorts.map(([value, label]) => h('option', { key: value, value }, label)))
      ),
      showRecommendations && h('div', { className: 'plain-extensions-note', role: 'status', 'aria-live': 'polite' },
        catalog.error || (catalog.loading ? 'Loading popular extensions…' : 'Popular on Open VSX'),
        catalog.error && h('button', { type: 'button', onClick: () => catalog.loadPopular() }, 'Retry')
      )
    );
  }
}

class PlainExtensionComponent extends VSXExtensionComponent {
  renderAction(host) {
    const original = super.renderAction(host);
    const { extension, catalog } = this.props;
    if (!extension.installed || extension.uninstalled || extension.currentTask || original.type !== 'div') return original;
    const children = React.Children.toArray(original.props.children);
    children.pop(); // Replace the stock manage gear with a direct Settings action.
    children.push(h('button', {
      key: 'settings', type: 'button', className: 'plain-extension-icon codicon codicon-settings-gear',
      'aria-label': `Settings for ${extension.displayName}`, title: `Settings for ${extension.displayName}`,
      onClick: event => { event.stopPropagation(); catalog.openSettings(extension); }
    }));
    children.push(h('button', {
      key: 'manage', type: 'button', className: 'plain-extension-icon codicon codicon-ellipsis',
      'aria-label': `Manage ${extension.displayName}`, title: `Manage ${extension.displayName}`,
      onClick: event => this.manage(event)
    }));
    return h('div', { className: 'plain-extension-actions' }, ...children);
  }
}

class PlainExtensionsSource extends VSXExtensionsSource {
  init() {
    super.init();
    this.toDispose.push(this.catalog.onDidChange(reason => {
      if (reason === 'filters' || this.options.id === VSXExtensionsSourceOptions.RECOMMENDED) this.scheduleFireDidChange();
    }));
  }

  async getElements() {
    let entries = [...await super.getElements()];
    const recommended = this.options.id === VSXExtensionsSourceOptions.RECOMMENDED;
    if (recommended) entries = [...this.catalog.popular, ...entries];
    const filtered = filterAndSort(entries, {
      scope: recommended ? 'recommended' : this.catalog.scope,
      sort: this.catalog.sort,
      verifiedOnly: this.preferenceService.get('extensions.onlyShowVerifiedExtensions', false)
    }, this.searchModel.parseQuery().freeText);
    return filtered.map(extension => ({
      id: extension.id, open: () => extension.open(),
      render: host => h(PlainExtensionComponent, { extension, host, hoverService: extension.hoverService, catalog: this.catalog })
    })).values();
  }
}

class PlainExtensionsWidget extends VSXExtensionsWidget {
  renderTree(model) {
    if (this.options.id === 'searchResult' && this.extensionsSource.getModel().searchError) return super.renderTree(model);
    const root = model.root;
    if (root?.children?.length === 0) {
      const recommended = this.options.id === VSXExtensionsSourceOptions.RECOMMENDED;
      const text = recommended && this.catalog.loading ? 'Finding compatible extensions…' : 'No extensions match these filters.';
      return h('div', { className: 'plain-extensions-empty' }, text);
    }
    return super.renderTree(model);
  }
}

class PlainExtensionsViewContainer extends VSXExtensionsViewContainer {
  onAfterShow(message) {
    super.onAfterShow(message);
    if (document.body.classList.contains('plain-editor-ready')) this.catalog.activate();
  }
}

for (const type of [PlainExtensionsSearchBar, PlainExtensionsSource, PlainExtensionsWidget, PlainExtensionsViewContainer]) {
  decorate(injectable(), type);
  decorate(inject(Catalog), type.prototype, 'catalog');
}

function createSettingsDialog(preferences) {
  let dialog;
  return extension => {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'plain-extension-settings';
      dialog.setAttribute('aria-labelledby', 'plain-extension-settings-title');
      document.body.append(dialog);
    }
    dialog.replaceChildren();
    const header = document.createElement('div');
    header.className = 'plain-extension-settings-header';
    const title = document.createElement('h2');
    title.id = 'plain-extension-settings-title';
    title.textContent = `${extension.displayName} settings`;
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '×'; close.title = 'Close extension settings';
    close.setAttribute('aria-label', close.title); close.onclick = () => dialog.close();
    header.append(title, close);
    const description = document.createElement('p');
    description.className = 'plain-extension-settings-description';
    description.textContent = 'Changes are saved to your user settings.';
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Filter settings'; search.setAttribute('aria-label', 'Filter extension settings');
    search.className = 'plain-extension-settings-search';
    const body = document.createElement('div');
    body.className = 'plain-extension-settings-body';
    const properties = configurationProperties(extension);
    if (!properties.length) {
      const empty = document.createElement('p');
      empty.textContent = !extension.plugin && extension.installed
        ? 'Reload the app to load this extension’s settings.'
        : 'This extension does not provide configurable settings.';
      body.append(empty);
      search.hidden = true;
    }
    for (const [key, schema] of properties) {
      const row = document.createElement('section');
      row.className = 'plain-extension-setting'; row.dataset.settingKey = key;
      const label = document.createElement('label');
      label.textContent = schema.title || key;
      const detail = document.createElement('p');
      detail.textContent = schema.description || schema.markdownDescription || '';
      let input;
      let readValue;
      if (schema.enum) {
        input = document.createElement('select');
        for (const [index, value] of schema.enum.entries()) {
          input.add(new Option(schema.enumItemLabels?.[index] || String(value), JSON.stringify(value)));
        }
        readValue = () => JSON.parse(input.value);
      } else if (schema.type === 'boolean') {
        input = document.createElement('input'); input.type = 'checkbox';
        readValue = () => input.checked;
      } else if (schema.type === 'number' || schema.type === 'integer') {
        input = document.createElement('input'); input.type = 'number';
        input.step = schema.type === 'integer' ? '1' : 'any';
        if (schema.minimum !== undefined) input.min = String(schema.minimum);
        if (schema.maximum !== undefined) input.max = String(schema.maximum);
        readValue = () => {
          if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) throw new Error('Enter a valid number.');
          return input.valueAsNumber;
        };
      } else if (schema.type === 'string') {
        input = document.createElement('input'); input.type = 'text';
        readValue = () => input.value;
      } else {
        input = document.createElement('textarea'); input.rows = 4; input.spellcheck = false;
        readValue = () => {
          try { return JSON.parse(input.value); } catch { throw new Error('Enter valid JSON.'); }
        };
      }
      input.id = `plain-extension-setting-${body.children.length}`;
      label.htmlFor = input.id;
      const status = document.createElement('span');
      status.className = 'plain-extension-setting-status'; status.setAttribute('role', 'status');
      const reset = document.createElement('button');
      reset.type = 'button'; reset.textContent = 'Reset'; reset.title = `Reset ${key} to its default`;
      const sync = () => {
        const stored = preferences.inspectInScope(key, PreferenceScope.User);
        const value = stored === undefined ? schema.default : stored;
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else if (schema.enum) input.value = JSON.stringify(value);
        else if (input.tagName === 'TEXTAREA') input.value = value === undefined ? '' : JSON.stringify(value, null, 2);
        else input.value = value === undefined ? '' : String(value);
      };
      sync();
      let validate;
      const save = async resetValue => {
        status.textContent = ''; status.classList.remove('error');
        try {
          const value = resetValue ? undefined : readValue();
          if (!resetValue) {
            const Ajv = require('@theia/core/shared/ajv');
            validate ||= new Ajv({ strict: false, allErrors: true, validateSchema: false }).compile(schema);
            if (!validate(value)) throw new Error(validate.errors.map(error => error.message).join('; '));
          }
          input.disabled = true; reset.disabled = true;
          await preferences.set(key, value, PreferenceScope.User);
          status.textContent = resetValue ? 'Reset to default' : 'Saved';
          if (resetValue) sync();
        } catch (error) {
          status.textContent = error.message || 'Could not save this setting.';
          status.classList.add('error');
        } finally {
          input.disabled = false; reset.disabled = false;
        }
      };
      input.addEventListener('change', () => save(false));
      reset.onclick = () => save(true);
      const controls = document.createElement('div');
      controls.className = 'plain-extension-setting-controls';
      controls.append(input, reset);
      row.append(label, detail, controls, status);
      body.append(row);
    }
    const emptyFilter = document.createElement('p');
    emptyFilter.textContent = 'No settings match your search.'; emptyFilter.hidden = true;
    body.append(emptyFilter);
    search.oninput = () => {
      let visible = 0;
      const query = search.value.toLocaleLowerCase();
      for (const row of body.querySelectorAll('.plain-extension-setting')) {
        row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
        if (!row.hidden) visible++;
      }
      emptyFilter.hidden = visible > 0 || !properties.length;
    };
    dialog.append(header, description, search, body);
    if (!dialog.open) dialog.showModal();
  };
}

module.exports = function installExtensionsPanel(bind) {
  bind(Catalog).toDynamicValue(({ container }) => {
    const emitter = new Emitter();
    const catalog = new ExtensionCatalog({
      model: container.get(VSXExtensionsModel), registry: container.get(VSXRegistryService),
      extensionFactory: container.get(VSXExtensionFactory), apiFilter: container.get(OVSXApiFilterProvider),
      applicationServer: container.get(ApplicationServer), notify: reason => emitter.fire(reason)
    });
    catalog.onDidChange = emitter.event;
    catalog.openSettings = createSettingsDialog(container.get(PreferenceService));
    return catalog;
  }).inSingletonScope();

  bind(FrontendApplicationContribution).toDynamicValue(({ container }) => ({
    onStart() {
      // Customize these two factories before layout restoration creates the Extensions pane.
      // The factory objects are shared with WidgetManager, so saved pane IDs stay valid.
      const factories = container.getAll(WidgetFactory);
      const listFactory = factories.find(factory => factory.id === VSXExtensionsWidget.ID);
      listFactory.createWidget = options => {
        const child = SourceTreeWidget.createContainer(container, { virtualized: false, scrollIfActive: true });
        child.bind(VSXExtensionsSourceOptions).toConstantValue(options);
        child.bind(VSXExtensionsSource).to(PlainExtensionsSource);
        child.unbind(SourceTreeWidget);
        child.bind(VSXExtensionsWidgetOptions).toConstantValue(options);
        child.bind(PlainExtensionsWidget).toSelf();
        return child.get(PlainExtensionsWidget);
      };
      const viewFactory = factories.find(factory => factory.id === VSXExtensionsViewContainer.ID);
      viewFactory.createWidget = async () => {
        const child = container.createChild();
        child.bind(ViewContainerIdentifier).toConstantValue({ id: VSXExtensionsViewContainer.ID, progressLocationId: 'extensions' });
        child.bind(PlainExtensionsViewContainer).toSelf();
        child.bind(VSXExtensionsSearchBar).to(PlainExtensionsSearchBar).inSingletonScope();
        const view = child.get(PlainExtensionsViewContainer);
        const manager = child.get(WidgetManager);
        for (const id of ['searchResult', 'recommended', 'installed', 'builtin']) {
          const widget = await manager.getOrCreateWidget(VSXExtensionsWidget.ID, { id });
          view.addWidget(widget, { initiallyCollapsed: id === 'builtin' });
        }
        return view;
      };
    }
  })).inSingletonScope();
};
module.exports.Catalog = Catalog;
