'use strict';
const { execFileSync } = require('node:child_process');

function installDeb({ filename, version, run = execFileSync, root = process.getuid?.() === 0 }) {
  if (!filename || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid downloaded update');
  // Use argument arrays throughout, including for paths with spaces or quotes.
  // Cancellation or any dpkg failure must leave the editor open. An unrelated
  // successful apt repair is not evidence that our update was installed.
  run(root ? '/usr/bin/dpkg' : '/usr/bin/pkexec', root ? ['-i', filename] : ['/usr/bin/dpkg', '-i', filename],
    { timeout: 180000, stdio: 'pipe' });
  const installed = run('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'singularity'], { encoding: 'utf8' }).trim();
  if (installed !== version) throw new Error(`Installed version ${installed} does not match ${version}`);
}
module.exports = { installDeb };
