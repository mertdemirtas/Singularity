'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const npm = process.env.npm_execpath;
if (!npm || !fs.existsSync(npm)) throw new Error('Run setup with npm run setup.');
const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' };
let staging;
function run(args, cwd) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed (${result.status ?? result.signal}).`);
}

try {
  let installRoot = root;
  // POSIX make cannot build several native dependencies in paths with spaces.
  // MSBuild handles quoted paths, so Windows must keep its original junctions.
  if (process.platform !== 'win32' && /\s/.test(root)) {
    const temp = /\s/.test(os.tmpdir()) ? '/tmp' : os.tmpdir();
    staging = fs.mkdtempSync(path.join(temp, 'singularity-setup-'));
    for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, file), path.join(staging, file));
    fs.cpSync(path.join(root, 'extensions'), path.join(staging, 'extensions'), { recursive: true });
    installRoot = staging;
  }
  run(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], installRoot);
  run(['rebuild', '--ignore-scripts=false', 'drivelist', 'node-pty', 'keytar', '@parcel/watcher', '@theia/ffmpeg',
    '@vscode/windows-ca-certs', 'fsevents', 'esbuild', 'msgpackr-extract'], installRoot);
  const electron = spawnSync(process.execPath, [path.join(installRoot, 'node_modules/electron/install.js')], {
    cwd: installRoot, env, stdio: 'inherit', windowsHide: true
  });
  if (electron.error || electron.status !== 0) throw electron.error || new Error('Electron download failed.');
  run(['run', 'download:languages'], installRoot);
  if (staging) {
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
    for (const folder of ['node_modules', 'plugins']) {
      fs.cpSync(path.join(staging, folder), path.join(root, folder), { recursive: true, force: true, verbatimSymlinks: true });
    }
    const link = path.join(root, 'node_modules/plain-editor-ui');
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync('../extensions/plain-editor-ui', link, 'dir');
  }
  // Sandboxing is checked by the launcher, after installation. Linux may need
  // its helper configured by an administrator; setup itself never needs sudo.
  run(['run', 'build:release'], root);
} catch (error) {
  console.error(`Singularity setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (staging) fs.rmSync(staging, { recursive: true, force: true });
}
