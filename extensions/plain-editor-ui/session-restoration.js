'use strict';

// Theia starts some view resolvers without awaiting them. Preserve their
// promises so the session can wait for existing views, without opening new ones.
function trackRestoration(service, method) {
  const original = service[method].bind(service);
  service[method] = function (widget, ...args) {
    const result = original(widget, ...args);
    const previous = widget.plainRestoration;
    widget.plainRestoration = Promise.all([previous?.catch(() => {}), result]);
    widget.plainRetryRestoration = () => service[method](widget, ...args);
    widget.plainRestoration.catch(() => {}); // Reported by the startup barrier.
    return result;
  };
}

async function prepareRestoredSession({ shell, workspace, preferences, plugins, themes }) {
  await Promise.all([workspace.ready, workspace.roots, preferences.ready, plugins.didStart, themes?.initialized]);
  await shell.pendingUpdates;
  const prepared = new Set();
  const visit = widget => {
    if (!widget || widget.isDisposed) return [];
    const children = typeof widget.getTrackableWidgets === 'function' ? widget.getTrackableWidgets() : widget.widgets || [];
    return [...(prepared.has(widget) ? [] : [widget]), ...[...children].flatMap(visit)];
  };
  // Resolving a restored extension view can attach child trees/webviews. Include
  // those children before completing; never instantiate a closed widget.
  for (;;) {
    const roots = [...shell.mainPanel.widgets(), ...shell.widgets.filter(widget => widget.isVisible || typeof widget.getTerminal === 'function')];
    const pending = [...new Set(roots.flatMap(visit))];
    if (!pending.length) break;
    await Promise.all(pending.map(async widget => {
      prepared.add(widget);
      try {
        if (widget.plainRestorationFailed) { widget.plainRestorationFailed = false; widget.plainRetryRestoration?.(); }
        await widget.plainRestoration;
      } catch (error) { widget.plainRestorationFailed = true; throw error; }
      if (widget.isDisposed) return;
      await widget.prepareForStartup?.();
      if (widget.model?.root && typeof widget.model.refresh === 'function') await widget.model.refresh();
      // A hidden webview has no iframe yet. Its HTML/provider data is restored
      // above; wait for the frame handshake only when it will actually be shown.
      if (widget.isVisible && widget.ready?.promise) await widget.ready.promise;
    }));
  }
  await shell.pendingUpdates;
}

function guardStartupInput() {
  const guard = event => {
    if (document.body.classList.contains('plain-session-ready')) return;
    if (event.target.closest?.('.dialogOverlay,.quick-input-widget,.plain-restore-panel')) return;
    if (event.altKey && event.key === 'F4') return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  window.addEventListener('keydown', guard, true);
  return () => window.removeEventListener('keydown', guard, true);
}

async function restoreBeforeReveal(context) {
  const preload = document.querySelector('.theia-preload');
  const panel = document.createElement('div'); panel.className = 'plain-restore-panel';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = 'Restoring your session…'; panel.append(status); preload?.append(panel);
  for (;;) {
    try { await prepareRestoredSession(context); break; }
    catch (error) {
      console.error('Singularity: session restoration failed', error);
      preload?.classList.add('plain-restore-failed');
      status.setAttribute('role', 'alert'); status.textContent = `Could not restore the session: ${error.message}`;
      const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.type = 'button'; panel.append(retry);
      await new Promise(resolve => { retry.onclick = resolve; retry.focus(); });
      retry.remove(); preload?.classList.remove('plain-restore-failed'); status.setAttribute('role', 'status'); status.textContent = 'Restoring your session…';
    }
  }
  panel.remove();
}

module.exports = { trackRestoration, prepareRestoredSession, restoreBeforeReveal, guardStartupInput };
