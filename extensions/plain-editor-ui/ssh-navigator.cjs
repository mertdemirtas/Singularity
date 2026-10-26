'use strict';
// Retain native tree nodes, parent links and expansion state, while giving local
// folders and connected devices separate navigators over the same workspace.
function scopedRoot(root, remote) {
  if (!root) return root;
  const hadRemote = root.children.some(node => node.uri?.scheme === 'ssh');
  root.children = root.children.filter(node => (node.uri?.scheme === 'ssh') === remote);
  if (remote) root.name = 'Remote';
  else if (hadRemote) root.name = root.children.length === 1 ? 'WorkspaceNode' : 'Local files';
  if (remote || hadRemote) for (const node of root.children) node.visible = remote || root.children.length !== 1;
  return root;
}
module.exports = { scopedRoot };
