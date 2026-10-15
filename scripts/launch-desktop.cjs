'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

require('./configure-sandbox.cjs');
if (process.exitCode) process.exit(process.exitCode);

const root = path.resolve(__dirname, '..');
// GUI launchers do not load the shell's nvm configuration.
const child = spawn(require('electron'), [root, ...process.argv.slice(2)], {
  cwd: root,
  env: {
    ...process.env,
    npm_node_execpath: process.execPath,
    PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter)
  },
  stdio: 'inherit'
});
child.once('error', error => { console.error('Singularity could not start:', error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
