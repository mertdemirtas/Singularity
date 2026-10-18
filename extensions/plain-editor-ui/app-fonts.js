'use strict';
const { decorate, injectable, inject } = require('@theia/core/shared/inversify');
const { PreferenceService } = require('@theia/core/lib/common/preferences/preference-service');
const { TerminalWidget } = require('@theia/terminal/lib/browser/base/terminal-widget');
const { TerminalWidgetImpl } = require('@theia/terminal/lib/browser/terminal-widget-impl');
const { WebviewThemeDataProvider } = require('@theia/plugin-ext/lib/main/browser/webview/webview-theme-data-provider');

class AppTerminalWidget extends TerminalWidgetImpl {
  start(id) {
    const started = super.start(id);
    this.plainRestoration = started.then(async result => { await this.waitForConnection?.promise; return result; });
    this.plainRestoration.catch(() => {}); // Reported by the session barrier.
    return started;
  }
  init() {
    super.init(); this.updateConfig();
    this.toDispose.push(this.appPreferences.onPreferenceChanged(change => {
      if (change.preferenceName === 'editor.fontFamily') { this.updateConfig(); this.needsResize = true; this.update(); }
    }));
  }
  updateConfig() {
    super.updateConfig();
    this.term.options.fontFamily = this.appPreferences.get('editor.fontFamily', 'monospace');
  }
}
class AppWebviewThemeDataProvider extends WebviewThemeDataProvider {
  computeThemeData() {
    const data = super.computeThemeData();
    // Theia otherwise hardcodes a system font for extension webview UI.
    for (const key of ['theia-font-family','vscode-font-family']) data.styles[key] = this.editorPreferences['editor.fontFamily'] || 'monospace';
    return data;
  }
}
decorate(injectable(), AppTerminalWidget);
decorate(inject(PreferenceService), AppTerminalWidget.prototype, 'appPreferences');
decorate(injectable(), AppWebviewThemeDataProvider);
module.exports = rebind => {
  rebind(TerminalWidget).to(AppTerminalWidget).inTransientScope();
  rebind(WebviewThemeDataProvider).to(AppWebviewThemeDataProvider).inSingletonScope();
};
