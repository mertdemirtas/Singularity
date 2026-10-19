'use strict';

async function reviewClose({ windowService, stopReason, recovery, storeLayout, flushState }) {
  let approved = false;
  try {
    if (!await windowService.isSafeToShutDown(stopReason)) return false;
    await recovery?.flush({ closing: true });
    storeLayout();
    await flushState();
    approved = true;
    return true;
  } finally {
    // Theia disables future dirty-document vetoes after a successful review.
    // If persistence then fails, a retry must review any newly typed work too.
    if (!approved) windowService.allowVetoes = true;
  }
}
module.exports = { reviewClose };
