'use strict';

const fs = require('node:fs');
const path = require('node:path');

if (process.platform === 'linux') {
  const helper = path.resolve(__dirname, '../node_modules/electron/dist/chrome-sandbox');
  const configured = filename => {
    try {
      const stat = fs.statSync(filename);
      return stat.isFile() && stat.uid === 0 && (stat.mode & 0o7777) === 0o4755;
    } catch { return false; }
  };
  if (!configured(helper)) {
    // npm replaces the bundled helper when Electron is upgraded. Reuse the
    // installed, root-managed Chrome helper without weakening the sandbox.
    const systemHelper = '/opt/google/chrome/chrome-sandbox';
    if (configured(systemHelper)) {
      fs.rmSync(helper, { force: true });
      fs.symlinkSync(systemHelper, helper);
      console.log('Electron sandbox: using the installed Chrome sandbox helper.');
    } else {
      console.error('Configure the Electron sandbox helper before launching:\n'
        + 'sudo chown root:root node_modules/electron/dist/chrome-sandbox\n'
        + 'sudo chmod 4755 node_modules/electron/dist/chrome-sandbox');
      process.exitCode = 1;
    }
  }
}
