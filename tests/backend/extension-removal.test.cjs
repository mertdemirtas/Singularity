'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PluginType } = require('@theia/plugin-ext');
const { ExtensionRemoval } = require('../../extensions/plain-editor-ui/extension-removal.cjs');

function fixture(overrides = {}) {
  const calls = [];
  const extension = {
    id: 'test.extension', installed: true, builtin: false, installedVersion: '1.0.0',
    plugin: { type: PluginType.User }, uninstall: async () => calls.push('uninstall'), ...overrides
  };
  const removal = new ExtensionRemoval({
    verify: async () => { calls.push('verify'); return true; },
    refresh: async () => calls.push('refresh'), notify: () => calls.push('notify')
  });
  return { calls, extension, removal };
}

test('user extensions can be removed, including disabled extensions', async () => {
  const { calls, extension, removal } = fixture({ disabled: true });
  assert(removal.canRemove(extension));
  await removal.remove(extension);
  assert.deepEqual(calls, ['notify', 'uninstall', 'verify', 'refresh', 'notify']);
  assert.equal(removal.pending.size, 0);
});

test('built-in, absent, uninstalled and busy extensions cannot be removed', async () => {
  for (const changes of [
    { builtin: true }, { plugin: { type: PluginType.System } }, { builtin: undefined },
    { installed: false }, { uninstalled: true }, { currentTask: 'Installing' },
    { installedVersion: undefined }, { uninstall: undefined }
  ]) {
    const { calls, extension, removal } = fixture(changes);
    assert.equal(removal.canRemove(extension), false);
    await assert.rejects(removal.remove(extension), /Only installed, non-built-in/);
    assert.deepEqual(calls, []);
  }
  assert.equal(fixture().removal.canRemove(undefined), false);
});

test('duplicate removals are blocked while the native operation is pending', async () => {
  let finish;
  const { extension, removal } = fixture({ uninstall: () => new Promise(resolve => { finish = resolve; }) });
  const task = removal.remove(extension);
  assert.equal(removal.canRemove(extension), false);
  await assert.rejects(removal.remove(extension), /Only installed, non-built-in/);
  finish(); await task;
  assert.equal(removal.pending.size, 0);
});

test('uninstall failure is reported and allows retry', async () => {
  const { calls, extension, removal } = fixture({ uninstall: async () => { throw Error('Permission denied'); } });
  await assert.rejects(removal.remove(extension), /Permission denied/);
  assert.deepEqual(calls, ['notify', 'notify']);
  assert(removal.canRemove(extension));
  extension.uninstall = async () => {};
  await removal.remove(extension);
  assert.equal(removal.pending.size, 0);
});

test('a native no-op is reported as failure rather than claiming removal', async () => {
  const { calls, extension, removal } = fixture();
  removal.verify = async () => false;
  await assert.rejects(removal.remove(extension), /could not be removed/);
  assert.deepEqual(calls, ['notify', 'uninstall', 'notify']);
  assert.equal(removal.pending.size, 0);
});

test('refresh errors reach the caller and always release pending state', async () => {
  const { extension, removal } = fixture();
  removal.refresh = async () => { throw Error('Connection closed'); };
  await assert.rejects(removal.remove(extension), /Connection closed/);
  assert.equal(removal.pending.size, 0);
});
