'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { reviewClose } = require('../../extensions/plain-editor-ui/close-review.cjs');
function fixture() {
  const windowService = { allowVetoes: true, async isSafeToShutDown() { this.allowVetoes = false; return true; } };
  return { windowService, recovery: { flush: async () => {} }, storeLayout() {}, flushState: async () => {} };
}
test('a failed session flush does not disable dirty-document review for the next close attempt', async () => {
  const options = fixture(); options.flushState = async () => { throw new Error('disk full'); };
  await assert.rejects(reviewClose(options), /disk full/);
  assert.equal(options.windowService.allowVetoes, true);
});
test('a failed recovery flush keeps the window open and restores future close reviews', async () => {
  const options = fixture(); options.recovery.flush = async () => { throw new Error('recovery unavailable'); };
  await assert.rejects(reviewClose(options), /recovery unavailable/);
  assert.equal(options.windowService.allowVetoes, true);
});
test('only a fully persisted and approved close disables the final unload guard', async () => {
  const options = fixture();
  assert.equal(await reviewClose(options), true); assert.equal(options.windowService.allowVetoes, false);
  options.windowService.isSafeToShutDown = async () => false;
  assert.equal(await reviewClose(options), false); assert.equal(options.windowService.allowVetoes, true);
});
