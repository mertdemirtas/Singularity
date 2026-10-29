'use strict';

function commandOwners(plugins) {
  const owners = new Map();
  for (const plugin of plugins) {
    const owner = plugin.metadata.model.id;
    for (const command of plugin.contributes?.commands || []) owners.set(command.command, owner);
    for (const submenu of plugin.contributes?.submenus || []) owners.set(submenu.id, owner);
  }
  for (const plugin of plugins) for (const items of Object.values(plugin.contributes?.menus || {})) {
    for (const item of items) if (item.command && !owners.has(item.command)) owners.set(item.command, plugin.metadata.model.id);
  }
  return owners;
}
function toolbarOwner(item, owners) {
  if (item.id.startsWith('plain-editor.')) return 'editor';
  const command = item.action?.command || item.toolbarItem?.command || item.menuNode?.id || item.id;
  return owners.get(command) || 'editor';
}
function sections(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.node) continue;
    if (!groups.has(entry.owner)) groups.set(entry.owner, []);
    groups.get(entry.owner).push(entry);
  }
  return [...groups];
}
module.exports = { commandOwners, toolbarOwner, sections };

function fitToolbar(entries, budget, hasMore = false) {
  const hidden = new Set(), divider = 9, moreWidth = 24;
  const width = () => {
    const shown = entries.filter(entry => !hidden.has(entry.id));
    const owners = new Set(shown.map(entry => entry.owner));
    if (hasMore || hidden.size) owners.add('editor');
    return shown.reduce((total, entry) => total + entry.width, 0) + (hasMore || hidden.size ? moreWidth : 0) + Math.max(0, owners.size - 1) * divider;
  };
  if (width() <= budget) return hidden;
  // Collapse whole extension sections first, preserving their internal order.
  for (const [owner, items] of sections(entries.map(entry => ({ ...entry, node: true })))) {
    if (owner === 'editor' || items.some(item => !item.canOverflow)) continue;
    for (const item of items) hidden.add(item.id);
    if (width() <= budget) return hidden;
  }
  const optional = entries.filter(entry => entry.owner === 'editor' && entry.canOverflow && entry.id !== 'plain-editor.new-file');
  // Keep PDF export and focus mode inline longer than secondary editor actions.
  optional.sort((a, b) => Number(['plain-editor.export-pdf', 'plain-editor.focus'].includes(a.id)) - Number(['plain-editor.export-pdf', 'plain-editor.focus'].includes(b.id)));
  for (const entry of optional) {
    hidden.add(entry.id);
    if (width() <= budget) break;
  }
  return hidden;
}
module.exports.fitToolbar = fitToolbar;
