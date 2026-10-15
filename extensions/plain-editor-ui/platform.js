'use strict';

const { isOSX } = require('@theia/core/lib/common/os');
const isMac = typeof window !== 'undefined' && window.plainEditorDesktop
  ? window.plainEditorDesktop.platform === 'darwin' : isOSX;
const primaryModifier = isMac ? 'Cmd' : 'Ctrl';
const primaryPressed = event => isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
const navigationShortcut = direction => isMac
  ? (direction < 0 ? 'Ctrl+-' : 'Ctrl+Shift+-')
  : (direction < 0 ? 'Alt+Left' : 'Alt+Right');
function navigationDirection(event) {
  if (event.defaultPrevented) return 0;
  if (isMac) return event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Minus' ? (event.shiftKey ? 1 : -1) : 0;
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
}

module.exports = { isMac, primaryModifier, primaryPressed, navigationShortcut, navigationDirection };
