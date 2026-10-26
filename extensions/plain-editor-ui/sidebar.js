'use strict';

const ORDER = 'plainEditor.sidebarOrder';
const HIDDEN = 'plainEditor.hiddenSidebarItems';
const BOTTOM = '$bottom';
const DEFAULT_ORDER = ['files', 'source-control', 'remote', BOTTOM, 'extensions', 'terminal', 'menu'];

function itemOrder(saved, available) {
  const result = [...new Set((Array.isArray(saved) ? saved : DEFAULT_ORDER).filter(id => typeof id === 'string'))];
  if (!result.includes(BOTTOM)) result.push(BOTTOM);
  const known = new Set(result);
  const added = available.filter(id => !known.has(id));
  result.splice(result.indexOf(BOTTOM), 0, ...added);
  return result;
}

function moveItem(order, id, before) {
  if (id === before || id === BOTTOM || !order.includes(id)) return order;
  const result = order.filter(value => value !== id);
  const index = before === undefined ? result.length : result.indexOf(before);
  if (before !== undefined && index < 0) return order;
  result.splice(index, 0, id);
  return result;
}

class Sidebar {
  constructor({ header, preferences, savePreference, messages, openSettings, openExtensionSettings, onHide }) {
    Object.assign(this, { header, preferences, savePreference, messages, openSettings, openExtensionSettings, onHide });
    this.items = new Map();
    this.top = header.querySelector('.plain-rail-tools');
    this.bottom = header.querySelector('.plain-rail-footer');
    this.menu = document.createElement('div');
    this.menu.id = 'plain-extension-view-context';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Sidebar options');
    this.menu.hidden = true;
    header.append(this.menu);
    this.top.addEventListener('scroll', () => this.closeMenu());
    header.addEventListener('contextmenu', event => {
      if (this.menu.contains(event.target)) { event.preventDefault(); return; }
      event.preventDefault(); event.stopPropagation();
      const item = event.target.closest('[data-sidebar-item]');
      this.showMenu(event.clientX, event.clientY, item?.dataset.sidebarItem);
    });
    for (const zone of [this.top, this.bottom]) {
      zone.addEventListener('dragover', event => {
        if (!this.dragging) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
        const target = event.target.closest('[data-sidebar-item]');
        this.clearDropTarget();
        if (target && target.dataset.sidebarItem !== this.dragging) {
          const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
          target.classList.add(after ? 'plain-drop-after' : 'plain-drop-before');
        }
      });
      zone.addEventListener('drop', event => {
        if (!this.dragging) return;
        event.preventDefault(); event.stopPropagation();
        const target = event.target.closest('[data-sidebar-item]');
        let before = zone === this.top ? BOTTOM : undefined;
        const order = this.order();
        if (target) {
          before = target.dataset.sidebarItem;
          if (target.classList.contains('plain-drop-after')) before = order[order.indexOf(before) + 1];
        }
        const id = this.dragging;
        this.endDrag();
        this.save(ORDER, moveItem(order, id, before));
      });
    }
    this.menu.addEventListener('keydown', event => {
      const buttons = [...this.menu.querySelectorAll('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.stopPropagation(); this.closeMenu(); this.menuAnchor?.focus(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    });
    preferences.onPreferenceChanged(change => {
      if ([ORDER, HIDDEN].includes(change.preferenceName)) { this.closeMenu(); this.refresh(); }
    });
    for (const button of header.querySelectorAll('[data-plain-action]')) {
      if (button.parentElement !== this.top && button.parentElement !== this.bottom) continue;
      this.register(button.dataset.plainAction, button, button.title);
    }
  }

  register(id, button, label, extension = false) {
    const existing = this.items.get(id);
    if (existing) { existing.label = label; return; }
    const wrapper = document.createElement('div');
    wrapper.className = 'plain-rail-item'; wrapper.dataset.sidebarItem = id;
    button.replaceWith(wrapper); wrapper.append(button);
    button.draggable = true;
    button.addEventListener('dragstart', event => {
      this.closeMenu(); this.dragging = id;
      this.header.classList.add('plain-sidebar-dragging');
      event.dataTransfer.setData('application/x-singularity-sidebar-item', id);
      event.dataTransfer.effectAllowed = 'move'; wrapper.classList.add('plain-dragging');
    });
    button.addEventListener('dragend', () => this.endDrag());
    this.items.set(id, { id, button, wrapper, label, extension });
  }

  unregister(id) { this.items.get(id)?.wrapper.remove(); this.items.delete(id); }
  order() { return itemOrder(this.preferences.get(ORDER, DEFAULT_ORDER), [...this.items.keys()]); }
  hidden() { const value = this.preferences.get(HIDDEN, []); return new Set(Array.isArray(value) ? value : []); }

  refresh() {
    const hidden = this.hidden();
    let zone = this.top, index = 0;
    for (const id of this.order()) {
      if (id === BOTTOM) { zone = this.bottom; index = 0; continue; }
      const item = this.items.get(id);
      if (!item) continue;
      item.wrapper.hidden = hidden.has(id);
      if (zone.children[index] !== item.wrapper) zone.insertBefore(item.wrapper, zone.children[index] || null);
      index++;
    }
  }

  async save(key, value) {
    try { await this.savePreference(key, value); this.refresh(); }
    catch (error) { this.messages.error(`Could not save sidebar settings: ${error.message}`); }
  }

  async hide(id) {
    this.closeMenu();
    const hidden = this.hidden(); hidden.add(id);
    await this.save(HIDDEN, [...hidden]);
    if (this.hidden().has(id)) await this.onHide(this.items.get(id)?.button);
  }

  closeMenu() { this.menu.hidden = true; }
  clearDropTarget() { for (const item of this.items.values()) item.wrapper.classList.remove('plain-drop-before', 'plain-drop-after'); }
  endDrag() { this.dragging = undefined; this.header.classList.remove('plain-sidebar-dragging'); this.clearDropTarget(); for (const item of this.items.values()) item.wrapper.classList.remove('plain-dragging'); }

  showMenu(x, y, id) {
    this.closeMenu(); this.menu.replaceChildren();
    this.menuAnchor = this.items.get(id)?.button;
    const add = (label, run, checked) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (checked !== undefined) button.setAttribute('aria-checked', String(checked));
      button.onclick = async event => {
        event.stopPropagation(); this.closeMenu();
        try { await run(); } catch (error) { this.messages.error(error.message); }
      };
      this.menu.append(button); return button;
    };
    if (id && this.items.has(id)) {
      const item = this.items.get(id);
      if (item.extension) add('Extension settings…', () => this.openExtensionSettings(id));
      add(`Hide ${item.label}`, () => this.hide(id));
      const order = this.order(); const index = order.indexOf(id);
      add('Move up', () => this.save(ORDER, moveItem(order, id, order[index - 1]))).disabled = index === 0;
      add('Move down', () => this.save(ORDER, moveItem(order, id, order[index + 2]))).disabled = index === order.length - 1;
      this.menu.append(document.createElement('hr'));
    }
    const hidden = this.hidden();
    for (const itemId of this.order()) {
      const item = this.items.get(itemId); if (!item) continue;
      add(item.label, () => {
        if (!hidden.has(itemId)) return this.hide(itemId);
        hidden.delete(itemId); return this.save(HIDDEN, [...hidden]);
      }, !hidden.has(itemId));
    }
    this.menu.append(document.createElement('hr'));
    add('Reset sidebar', async () => { await this.savePreference(ORDER, undefined); await this.savePreference(HIDDEN, undefined); this.refresh(); });
    add('Settings…', this.openSettings);
    this.menu.hidden = false;
    this.menu.style.left = `${Math.max(8, Math.min(x, innerWidth - this.menu.offsetWidth - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(y, innerHeight - this.menu.offsetHeight - 8))}px`;
    this.menu.querySelector('button')?.focus();
  }
}

module.exports = { Sidebar, ORDER, HIDDEN, BOTTOM, DEFAULT_ORDER, itemOrder, moveItem };
