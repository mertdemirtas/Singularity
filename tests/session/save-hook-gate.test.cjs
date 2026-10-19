'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { SaveHookGate } = require('../../extensions/plain-editor-ui/save-hook-gate.cjs');
test('hung save participants time out, skip subsequent calls, and discard late edits', async () => {
  let resolve, calls = 0; const warnings = [], gate = new SaveHookGate(value => warnings.push(value));
  assert.deepEqual(await gate.run(() => { calls++; return new Promise(r => { resolve = r; }); }, 5), []);
  for (let i = 0; i < 200; i++) assert.deepEqual(await gate.run(() => { calls++; }), []);
  assert.equal(calls, 1); assert.equal(gate.stalled.size, 1); assert.equal(warnings.length, 1);
  resolve([{ text: 'late edits must not be applied' }]); await new Promise(setImmediate);
  assert.equal(gate.stalled.size, 0);
  assert.deepEqual(await gate.run(async () => [{ text: 'healthy edits' }]), [{ text: 'healthy edits' }]);
});
test('a rejected save hook releases its timer and does not disable later hooks', async () => {
  const gate = new SaveHookGate(() => {});
  assert.deepEqual(await gate.run(async () => { throw new Error('host failed'); }), []);
  assert.deepEqual(await gate.run(async () => []), []);
  gate.dispose(); assert.deepEqual(await gate.run(() => assert.fail('disposed hook ran')), []);
});
test('disposing an extension host releases pending saves and timers immediately', async () => {
  const gate = new SaveHookGate(() => assert.fail('disposed host warned'));
  const saved = gate.run(() => new Promise(() => {}), 10000);
  gate.dispose(); assert.deepEqual(await saved, []);
  assert.equal(gate.active.size, 0); assert.equal(gate.stalled.size, 0);
});
