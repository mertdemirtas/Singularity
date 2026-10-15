'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

require('./configure-sandbox.cjs');
if (process.exitCode) process.exit(process.exitCode);

const root = path.resolve(__dirname, '..');
// GUI launchers do not load the shell's Node configuration. Preserve Windows'
// existing Path spelling to avoid passing two different case variants.
const env = { ...process.env, npm_node_execpath: process.execPath };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [path.dirname(process.execPath), env[pathKey]].filter(Boolean).join(path.delimiter);
if (process.platform !== 'win32' && !env.SHELL) env.SHELL = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
const child = spawn(require('electron'), [root, ...process.argv.slice(2)], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: 'inherit'
});
child.once('error', error => { console.error('Singularity could not start:', error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
