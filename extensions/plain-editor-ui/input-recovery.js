'use strict';

module.exports = function recoverInput(shell) {
  const reset = () => {
    const panels = [shell.mainPanel, shell.bottomPanel, shell.leftPanelHandler.dockPanel, shell.rightPanelHandler.dockPanel];
    for (const panel of panels) {
      for (const bar of panel.tabBars()) bar.releaseMouse();
    }
    // Lumino's dock/split handles have no public release method. They retain
    // document capture listeners until pointerup, which sleep/blur can lose.
    for (const panel of [...panels, ...shell.layout.widgets]) {
      if (panel._pressData) panel._releaseMouse();
    }
  };
  const hidden = () => { if (document.hidden) reset(); };
  const released = event => { if (event.buttons === 0) reset(); };
  window.addEventListener('blur', reset);
  window.addEventListener('focus', reset);
  window.addEventListener('pointercancel', reset, true);
  window.addEventListener('pointermove', released, true);
  document.addEventListener('visibilitychange', hidden);
  const unsubscribe = window.plainEditorDesktop?.onResume?.(reset);
  return () => {
    unsubscribe?.();
    window.removeEventListener('blur', reset);
    window.removeEventListener('focus', reset);
    window.removeEventListener('pointercancel', reset, true);
    window.removeEventListener('pointermove', released, true);
    document.removeEventListener('visibilitychange', hidden);
  };
};
