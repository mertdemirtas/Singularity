'use strict';

// Discover contributions before widgets exist: views with setup/when clauses
// may have no attached pane until the user explicitly opens them.
module.exports = function extensionViewItems(registry) {
  return [...registry.viewContainers.values()]
    .filter(entry => ['left', 'right'].includes(entry.location)
      && registry.getContainerViews(entry.id).length > 0
      && registry.isViewContainerVisible(entry.id))
    .map(entry => ({ id: entry.id, label: entry.options.label, iconClass: entry.options.iconClass || '' }))
    .sort((a, b) => a.label.localeCompare(b.label));
};
