'use strict';

const { browserUrl } = require('./browser-address.cjs');
const LIMITS = { visited: 24, closed: 12 };

function entry(value) {
  if (!value || typeof value.url !== 'string' || value.url.length > 8192 || !/^https?:\/\//i.test(value.url)) return undefined;
  try {
    const url = browserUrl(value.url);
    if (url === 'about:blank') return undefined;
    return { url, title: typeof value.title === 'string' ? value.title.slice(0, 300) : '',
      visitedAt: Number.isFinite(value.visitedAt) ? value.visitedAt : Date.now() };
  } catch { return undefined; }
}

function sanitize(value) {
  return Object.fromEntries(Object.entries(LIMITS).map(([key, limit]) => {
    const seen = new Set();
    const items = (Array.isArray(value?.[key]) ? value[key] : []).map(entry).filter(item => {
      if (!item || seen.has(item.url)) return false;
      seen.add(item.url); return true;
    }).slice(0, limit);
    return [key, items];
  }));
}

class BrowserHistory {
  constructor({ read = async () => undefined, write = async () => {} } = {}) {
    Object.assign(this, { read, write });
    this.pending = Promise.resolve();
  }
  load() { return this.loaded ||= this.read().then(sanitize); }
  async list() { await this.pending; return structuredClone(await this.load()); }
  change(update) {
    const result = this.pending.then(async () => {
      const value = structuredClone(await this.load());
      if (update(value) !== false) {
        await this.write(value);
        this.loaded = Promise.resolve(value);
      }
      return structuredClone(value);
    });
    this.pending = result.catch(() => {});
    return result;
  }
  visit(page) {
    const item = entry(page);
    return this.change(value => {
      if (!item) return false;
      if (value.visited[0]?.url === item.url && value.visited[0]?.title === item.title
        && !value.closed.some(other => other.url === item.url)) return false;
      value.visited = [item, ...value.visited.filter(other => other.url !== item.url)].slice(0, LIMITS.visited);
      value.closed = value.closed.filter(other => other.url !== item.url);
    });
  }
  close(page) {
    const item = entry(page);
    return this.change(value => {
      if (!item) return false;
      value.closed = [item, ...value.closed.filter(other => other.url !== item.url)].slice(0, LIMITS.closed);
    });
  }
  clear() { return this.change(value => { value.visited = []; value.closed = []; }); }
}

module.exports = { BrowserHistory };
