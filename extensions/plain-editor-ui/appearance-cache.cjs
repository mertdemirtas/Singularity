'use strict';
function color(value) {
  if (typeof value !== 'string') return undefined;
  value = value.trim();
  if (/^#[a-f\d]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[a-f\d]{3}$/i.test(value)) return '#' + [...value.slice(1)].map(char => char + char).join('').toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.exec(value);
  if (rgb && rgb.slice(1).every(part => Number(part) <= 255)) return '#' + rgb.slice(1).map(part => Number(part).toString(16).padStart(2,'0')).join('');
}
function normalizeAppearance(value) {
  const background = color(value?.background), foreground = color(value?.foreground);
  if (!background || !foreground) return undefined;
  const fontFamily = typeof value.fontFamily === 'string' && value.fontFamily.length <= 512 && !/[\x00-\x1f;{}<>]/.test(value.fontFamily) ? value.fontFamily.trim() : 'monospace';
  return { background, foreground, fontFamily: fontFamily || 'monospace' };
}
module.exports = { normalizeAppearance };
