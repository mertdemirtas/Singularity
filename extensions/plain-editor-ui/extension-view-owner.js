'use strict';
module.exports = function extensionViewOwner(containerId, plugins) {
  const prefix = 'workbench.view.extension.';
  const id = containerId.startsWith(prefix) ? containerId.slice(prefix.length) : containerId;
  return plugins.find(plugin => Object.values(plugin.contributes?.viewsContainers || {})
    .some(containers => containers.some(container => container.id === id)));
};
