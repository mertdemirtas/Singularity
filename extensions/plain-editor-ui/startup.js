'use strict';

module.exports = function deferClosedViews(container) {
  const { trackRestoration } = require('./session-restoration');
  trackRestoration(container.get(require('@theia/plugin-ext/lib/hosted/browser/hosted-plugin').HostedPluginSupport), 'restoreWebview');
  trackRestoration(container.get(require('@theia/plugin-ext/lib/main/browser/custom-editors/plugin-custom-editor-registry').PluginCustomEditorRegistry), 'resolveWidget');
  trackRestoration(container.get(require('@theia/plugin-ext/lib/main/browser/view/plugin-view-registry').PluginViewRegistry), 'prepareView');
  // Singularity starts with its side panes closed. Theia normally constructs
  // every default pane before revealing the editor, only for us to hide them.
  // Keep their commands/factories and saved layout restoration intact; create
  // a fresh default pane when the user first opens it.
  const contributions = [
    require('@theia/navigator/lib/browser/navigator-contribution').FileNavigatorContribution,
    require('@theia/scm/lib/browser/scm-contribution').ScmContribution,
    require('@theia/search-in-workspace/lib/browser/search-in-workspace-frontend-contribution').SearchInWorkspaceFrontendContribution,
    require('@theia/outline-view/lib/browser/outline-view-contribution').OutlineViewContribution,
    require('@theia/debug/lib/browser/debug-frontend-application-contribution').DebugFrontendApplicationContribution,
    require('@theia/vsx-registry/lib/browser/vsx-extensions-contribution').VSXExtensionsContribution
  ];
  for (const token of contributions) container.get(token).initializeLayout = async () => {};
};
