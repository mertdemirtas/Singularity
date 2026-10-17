'use strict';

function browserUrl(value) {
  const input = String(value || '').trim();
  if (input === 'about:blank') return input;
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS address.');
  return url.href;
}

function browserInput(value) {
  const input = String(value || '').trim();
  if (!input) return 'about:blank';
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input) || /^(?:https?|about|file|data|javascript|blob|chrome|devtools):/i.test(input)) return browserUrl(input);
  const authority = input.split(/[/?#]/, 1)[0];
  const local = /^(?:localhost|\[[\da-f:.]+\]|\d+(?:\.\d+){3})(?::\d+)?$/i.test(authority);
  const hostWithPort = /^[\w.-]+:\d+$/.test(authority);
  const domain = /^(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+(?::\d+)?$/u.test(authority);
  if (local || hostWithPort || domain) return browserUrl(`${local || hostWithPort ? 'http' : 'https'}://${input}`);
  const search = new URL('https://www.google.com/search');
  search.searchParams.set('q', input);
  return search.href;
}

module.exports = { browserUrl, browserInput };
