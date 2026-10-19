'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const StateStore = require('../../electron/state-store.cjs');
const RecoveryStore = require('../../electron/recovery-store.cjs');

async function folder(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-backend-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
test('state recovers after an unreadable path is repaired instead of caching a rejected load forever', async t => {
  const directory = await folder(t), parent = path.join(directory, 'parent');
  await fs.writeFile(parent, 'temporarily blocked');
  const store = new StateStore(path.join(parent, 'state.json'));
  await assert.rejects(store.set('layout', 'tabs'));
  await assert.rejects(store.flush());
  await fs.rm(parent); await fs.mkdir(parent);
  await store.set('layout', 'recovered tabs'); await store.flush();
  assert.equal(await new StateStore(store.filename).get('layout'), 'recovered tabs');
});
test('damaged state is reported, kept on disk, and can be retried after repair', async t => {
  const filename = path.join(await folder(t), 'state.json');
  await fs.writeFile(filename, '{broken');
  const store = new StateStore(filename);
  await assert.rejects(store.get('layout'), SyntaxError);
  assert.equal(await fs.readFile(filename, 'utf8'), '{broken');
  await fs.writeFile(filename, '{"layout":"repaired"}');
  assert.equal(await store.get('layout'), 'repaired');
});
test('concurrent state writes preserve order, deletions and unrelated keys across restart', async t => {
  const store = new StateStore(path.join(await folder(t), 'state.json'));
  await Promise.all(Array.from({ length: 120 }, (_, i) => store.set('key' + i, i)));
  await Promise.all([store.set('layout', 'first'), store.set('layout', 'last'), store.set('key0', undefined)]);
  await store.flush();
  const reopened = new StateStore(store.filename);
  assert.equal(await reopened.get('layout'), 'last');
  assert.equal(await reopened.get('key119'), 119);
  assert.equal(await reopened.get('key0'), undefined);
});
test('failed atomic replacement preserves the previous durable state and permits retry', async t => {
  const store = new StateStore(path.join(await folder(t), 'state.json'));
  await store.set('layout', 'saved');
  await fs.mkdir(store.filename + '.tmp');
  await assert.rejects(store.set('layout', 'pending'));
  await assert.rejects(store.flush());
  assert.equal(await new StateStore(store.filename).get('layout'), 'saved');
  await fs.rm(store.filename + '.tmp', { recursive: true });
  await store.set('layout', 'retried'); await store.flush();
  assert.equal(await new StateStore(store.filename).get('layout'), 'retried');
});
const entry = () => ({ id: randomUUID(), uri: 'file:///tmp/example.txt', text: 'unsaved α\r\n', languageId: 'plaintext' });
test('recovery writes/removals preserve ordering and cannot resurrect discarded snapshots', async t => {
  const directory = await folder(t), store = new RecoveryStore(directory), snapshot = entry();
  await Promise.all([store.save(snapshot), store.save({ ...snapshot, text: '' }), store.remove(snapshot.id)]);
  await store.flush();
  assert.deepEqual((await new RecoveryStore(directory).list()).entries, []);
  assert.deepEqual(await fs.readdir(directory), []);
});
test('recovery failure remains visible until that document succeeds, independently of other writes', async t => {
  const directory = await folder(t), store = new RecoveryStore(directory), bad = entry(), good = entry();
  await fs.mkdir(path.join(directory, bad.id + '.json.tmp'));
  await assert.rejects(store.save(bad)); await store.save(good);
  await assert.rejects(store.flush());
  await fs.rm(path.join(directory, bad.id + '.json.tmp'), { recursive: true });
  await store.save(bad); await store.flush();
  assert.equal((await new RecoveryStore(directory).list()).entries.length, 2);
});
test('malformed recovery IDs cannot write outside the recovery directory', async t => {
  const directory = await folder(t), store = new RecoveryStore(directory);
  await assert.rejects(store.save({ ...entry(), id: '../escape' }), /Invalid/);
  await assert.rejects(store.remove('../escape'), /Invalid/);
  assert.deepEqual(await fs.readdir(directory), []);
});
