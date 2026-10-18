'use strict';
const { decorate, injectable } = require('@theia/core/shared/inversify');
const { TerminalWidget } = require('@theia/terminal/lib/browser/base/terminal-widget');
const { TerminalWidgetImpl } = require('@theia/terminal/lib/browser/terminal-widget-impl');

class AppTerminalWidget extends TerminalWidgetImpl {
  start(id) {
    const started = super.start(id);
    this.plainRestoration = started.then(async result => { await this.waitForConnection?.promise; return result; });
    this.plainRestoration.catch(() => {}); // Reported by the session barrier.
    return started;
  }
}
decorate(injectable(), AppTerminalWidget);
module.exports = rebind => {
  rebind(TerminalWidget).to(AppTerminalWidget).inTransientScope();
};
