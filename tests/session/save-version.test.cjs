'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { saveWithVersion } = require('../../extensions/plain-editor-ui/save-version.cjs');
function fixture() {
  let text = 'first', version = 1, release, submitted;
  const pending = new Promise(resolve => { release = resolve; });
  const document = {
    resource: { saveContents() {}, version: 1 }, contentChanges: [{ text: 'first' }], dirty: true,
    model: { getAlternativeVersionId: () => version, getValueLength: () => text.length, getValue: () => text },
    fireWillSaveModel: async () => {}, getEncoding: () => 'utf8', updateContentEncoding() {},
    setValid() {}, setDirty(value) { this.dirty = value; }, fireDidSaveModel() { this.saved = true; }
  };
  const api = { Resource: { save: async (resource, snapshot) => { submitted = snapshot.content; await pending; } }, ResourceError: { OutOfSync: { is: () => false } } };
  return { document, api, release, get submitted() { return submitted; }, edit(value) { text = value; version++; document.dirty = true; document.contentChanges.push({ text: value }); } };
}
test('typing while an uncancelled save is pending preserves newer edits and the saved version', async () => {
  const f = fixture(), saving = saveWithVersion.call(f.document, f.api, { isCancellationRequested: false }, false, { saveReason: 1 });
  await new Promise(setImmediate); assert.equal(f.submitted, 'first');
  f.edit('typed while saving'); f.release(); await saving;
  assert.equal(f.document.dirty, true); assert.equal(f.document.bufferSavedVersionId, 1);
  assert.deepEqual(f.document.contentChanges, [{ text: 'typed while saving' }]);
  await saveWithVersion.call(f.document, f.api, { isCancellationRequested: false }, false, { saveReason: 1 });
  assert.equal(f.submitted, 'typed while saving'); assert.equal(f.document.dirty, false); assert.equal(f.document.bufferSavedVersionId, 2);
});
test('unchanged saves clear dirty state, and failed writes retain changes and saved-version metadata', async () => {
  const f = fixture(); f.release(); await saveWithVersion.call(f.document, f.api, { isCancellationRequested: false }, false, { saveReason: 1 });
  assert.equal(f.document.dirty, false); assert(f.document.saved); assert.equal(f.document.contentChanges.length, 0);
  f.edit('unsaved'); f.api.Resource.save = async () => { throw Error('network lost'); };
  await assert.rejects(saveWithVersion.call(f.document, f.api, { isCancellationRequested: false }, false, { saveReason: 1 }), /network lost/);
  assert.equal(f.document.dirty, true); assert.equal(f.document.bufferSavedVersionId, 1); assert.equal(f.document.contentChanges.length, 1);
});
test('save hooks are applied before capturing the version and cancelled saves do not write', async () => {
  const f = fixture(); f.release();
  f.document.fireWillSaveModel = async () => f.edit('formatted by save hook');
  const token = { isCancellationRequested: false };
  await saveWithVersion.call(f.document, f.api, token, false, { saveReason: 1 });
  assert.equal(f.submitted, 'formatted by save hook'); assert.equal(f.document.bufferSavedVersionId, 2); assert.equal(f.document.dirty, false);
  f.edit('must stay unsaved'); f.document.fireWillSaveModel = async () => { token.isCancellationRequested = true; };
  await saveWithVersion.call(f.document, f.api, token, false, { saveReason: 1 });
  assert.equal(f.submitted, 'formatted by save hook'); assert.equal(f.document.dirty, true);
});
