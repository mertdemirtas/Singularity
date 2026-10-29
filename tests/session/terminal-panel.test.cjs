'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { closeTerminals } = require('../../extensions/plain-editor-ui/terminal-panel-actions.cjs');

test('close all leaves sessions running when cancelled and skips disposed terminals', async () => {
  const terminals = [{ id: 'one', isDisposed: false }, { id: 'closed', isDisposed: true }];
  let count;
  await closeTerminals(terminals, { confirm: async value => { count = value; return false; }, close: () => assert.fail('Must not close on cancellation') });
  assert.equal(count, 1);
  const closed = [];
  await closeTerminals(terminals, { confirm: async () => true, close: async id => { closed.push(id); terminals[0].isDisposed = true; } });
  assert.deepEqual(closed, ['one']);
});

test('close all stops on rejection or an error instead of ignoring failed closes', async () => {
  const terminals = [{ id: 'one', isDisposed: false }, { id: 'two', isDisposed: false }], attempted = [];
  await closeTerminals(terminals, { confirm: async () => true, close: async id => attempted.push(id) });
  assert.deepEqual(attempted, ['one']);
  await assert.rejects(closeTerminals(terminals, { confirm: async () => true, close: async () => { throw Error('Failed to close'); } }), /Failed to close/);
});

