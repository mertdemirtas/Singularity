'use strict';
async function closeTerminals(terminals, { confirm, close }) {
  const opened = terminals.filter(terminal => !terminal.isDisposed);
  if (!opened.length || !await confirm(opened.length)) return;
  for (const terminal of opened) {
    if (terminal.isDisposed) continue;
    await close(terminal.id);
    // Respect any terminal that declined to close.
    if (!terminal.isDisposed) break;
  }
}
module.exports = { closeTerminals };
