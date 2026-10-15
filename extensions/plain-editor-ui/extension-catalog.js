'use strict';

function filterAndSort(extensions, { scope = 'all', sort = 'downloadCount', verifiedOnly = false } = {}, query = '') {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const unique = new Map();
  for (const extension of extensions) {
    const id = extension.id.toLowerCase();
    const disabled = extension.disabled || extension.disabledByTrust;
    if (scope === 'recommended' && (extension.installed || extension.builtin)) continue;
    if (scope === 'installed' && !extension.installed) continue;
    if (scope === 'builtin' && !extension.builtin) continue;
    if (scope === 'enabled' && (!extension.installed || disabled)) continue;
    if (scope === 'disabled' && (!extension.installed || !disabled)) continue;
    if (verifiedOnly && extension.verified !== true) continue;
    const text = [id, extension.displayName, extension.publisher, extension.description].join(' ').toLocaleLowerCase();
    if (!words.every(word => text.includes(word))) continue;
    unique.set(id, extension);
  }
  return [...unique.values()].sort((a, b) => {
    const difference = sort === 'name' ? 0 : (Number(b[sort]) || 0) - (Number(a[sort]) || 0);
    return difference || (a.displayName || a.id).localeCompare(b.displayName || b.id);
  });
}

function configurationProperties(extension) {
  const properties = new Map();
  const visit = schema => {
    if (!schema || typeof schema !== 'object') return;
    for (const [key, property] of Object.entries(schema.properties || {})) {
      if (property && property.included !== false) properties.set(key, property);
    }
    for (const child of schema.allOf || []) visit(child);
  };
  const configuration = extension.plugin?.contributes?.configuration;
  for (const schema of Array.isArray(configuration) ? configuration : [configuration]) visit(schema);
  return [...properties.entries()];
}

class ExtensionCatalog {
  constructor({ model, registry, extensionFactory, apiFilter, applicationServer, notify }) {
    Object.assign(this, { model, registry, extensionFactory, apiFilter, applicationServer, notify });
    this.scope = 'all';
    this.sort = 'downloadCount';
    this.popular = [];
    this.active = false;
    this.loading = false;
    this.loaded = false;
    this.error = '';
  }

  setScope(scope) {
    this.scope = scope;
    this.setQuery(this.model.search.parseQuery().freeText);
    this.notify('filters');
  }

  setQuery(text) {
    const token = { recommended: '@recommended', installed: '@installed', enabled: '@installed', disabled: '@installed', builtin: '@builtin' }[this.scope];
    this.model.search.query = [token, text].filter(Boolean).join(' ');
  }

  syncScope() {
    const token = this.model.search.query.split(/\s+/).find(value => ['@installed', '@recommended', '@builtin'].includes(value));
    if (token === '@installed' && !['enabled', 'disabled'].includes(this.scope)) this.scope = 'installed';
    else if (token === '@recommended') this.scope = 'recommended';
    else if (token === '@builtin') this.scope = 'builtin';
    else if (!token) this.scope = 'all';
  }

  activate() {
    this.active = true;
    if (!this.loaded && !this.loading && !this.error) this.loadPopular();
  }

  async loadPopular() {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.notify('popular');
    try {
      await this.model.initialized;
      const [filter, targetPlatform] = await Promise.all([this.apiFilter(), this.applicationServer.getApplicationPlatform()]);
      const result = await this.registry.search({ sortBy: 'downloadCount', sortOrder: 'desc', size: 48, includeAllVersions: true });
      if (result.error) throw new Error(result.error);
      const candidates = result.extensions.filter(entry => {
        const id = `${entry.namespace}.${entry.name}`.toLowerCase();
        return !this.model.isInstalled(id) && !this.model.isBuiltIn(id) && filter.getLatestCompatibleVersion(entry);
      });
      const popular = [];
      let failed = 0;
      // Resolve only the top candidates, four at a time, including platform compatibility.
      for (let start = 0; start < candidates.length && popular.length < 12; start += 4) {
        const resolved = await Promise.allSettled(candidates.slice(start, start + 4).map(async entry => {
          const id = `${entry.namespace}.${entry.name}`.toLowerCase();
          const data = await this.registry.findLatestCompatibleExtension({ extensionId: id, includeAllVersions: true, targetPlatform });
          if (!data || data.error || this.model.isInstalled(id)) return undefined;
          const extension = this.model.getExtension(id) || this.extensionFactory({ id, model: this.model });
          extension.update({
            ...data, downloadCount: entry.downloadCount, publisher: data.namespace,
            downloadUrl: data.files.download, iconUrl: data.files.icon,
            readmeUrl: data.files.readme, licenseUrl: data.files.license,
            verified: data.verified === true || data.publishedBy?.loginName === 'open-vsx'
          });
          return extension;
        }));
        for (const item of resolved) {
          if (item.status === 'fulfilled' && item.value) popular.push(item.value);
          else if (item.status === 'rejected') failed++;
        }
        this.popular = filterAndSort(popular, { scope: 'recommended' }).slice(0, 12);
        this.notify('popular');
      }
      if (candidates.length && !popular.length && failed) throw new Error('Extension details could not be loaded.');
      this.loaded = true;
    } catch (error) {
      console.error('Plain Editor: popular extensions', error);
      this.error = 'Could not load recommendations. Check your connection and try again.';
    } finally {
      this.loading = false;
      this.notify('popular');
    }
  }
}

module.exports = { ExtensionCatalog, filterAndSort, configurationProperties };
