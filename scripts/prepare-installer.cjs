'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'lib/backend/main.js'))) throw new Error('Run npm run setup before packaging.');
const target = path.join(root, '.release-runtime');
fs.rmSync(target, { recursive: true, force: true });
const bin = process.platform === 'win32' ? target : path.join(target, 'bin');
fs.mkdirSync(bin, { recursive: true });
const node = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
fs.copyFileSync(process.execPath, node);
if (process.platform !== 'win32') fs.chmodSync(node, 0o755);
const nodeLicense = [path.join(path.dirname(process.execPath), 'LICENSE'),
  path.resolve(path.dirname(process.execPath), '../LICENSE')].find(filename => fs.existsSync(filename));
if (!nodeLicense) throw new Error('Use an official Node distribution containing its LICENSE when packaging.');
fs.copyFileSync(nodeLicense, path.join(target, 'Node-LICENSE'));

// Include npm beside Node so extensions and project commands can find it too.
const candidates = [process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
const npmCli = candidates.find(filename => filename && fs.existsSync(filename));
if (!npmCli) throw new Error('Cannot locate npm for the bundled runtime. Run packaging through npm.');
const npmRoot = path.resolve(npmCli, '../..');
fs.cpSync(npmRoot, path.join(target, 'npm'), { recursive: true, dereference: true });
for (const name of ['npm', 'npx']) {
  const cli = `${name}-cli.js`;
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, name + '.cmd'), `@ECHO OFF\r\n"%~dp0node.exe" "%~dp0npm\\bin\\${cli}" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$SCRIPT_DIR/node" "$SCRIPT_DIR/../npm/bin/${cli}" "$@"\n`, { mode: 0o755 });
  }
}
fs.writeFileSync(path.join(target, 'release-info.json'), JSON.stringify({ nodeVersion: process.version,
  nodeAbi: process.versions.modules, platform: process.platform, arch: process.arch,
  macSigned: process.platform === 'darwin' && Boolean(process.env.CSC_LINK) }));
if (process.platform === 'darwin') execFileSync(process.execPath, [path.join(__dirname, 'prepare-sparkle.cjs')], { stdio: 'inherit' });
if (process.platform === 'linux') {
  execFileSync(process.execPath, [path.join(__dirname, 'prepare-linux-icons.cjs')], { stdio: 'inherit' });
  const template = fs.readFileSync(path.join(root, 'node_modules/app-builder-lib/templates/linux/after-install.tpl'), 'utf8');
  fs.writeFileSync(path.join(target, 'after-install.sh'), template
    + '\n# Keep Chromium sandboxing usable on Ubuntu with restricted user namespaces.\n'
    + "chown root:root '/opt/${sanitizedProductName}/chrome-sandbox'\n"
    + "chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox'\n");
}
console.log(`Bundled Node ${process.version} (${process.platform}/${process.arch}) and npm.`);
