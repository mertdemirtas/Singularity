'use strict';

// Build the official Sparkle CLI with our own bundle identifier. Sparkle verifies
// every update archive against the Ed25519 public key embedded in Singularity.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const version = '2.10.0';
const digest = 'c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c';
const root = path.resolve(__dirname, '..');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

async function download(url, target, hash) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Cannot download Sparkle: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash && createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Sparkle SDK checksum mismatch');
  await fs.writeFile(target, bytes);
}

(async () => {
  if (process.platform !== 'darwin') return;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-sparkle-'));
  try {
    const sdk = path.join(temp, 'sdk');
    await fs.mkdir(sdk);
    await download(`https://github.com/sparkle-project/Sparkle/releases/download/${version}/Sparkle-${version}.tar.xz`, path.join(temp, 'sdk.tar.xz'), digest);
    run('tar', ['-xf', path.join(temp, 'sdk.tar.xz'), '-C', sdk]);
    const sources = ['main.m', 'SPUCommandLineDriver.h', 'SPUCommandLineDriver.m', 'SPUCommandLineUserDriver.h', 'SPUCommandLineUserDriver.m'];
    await Promise.all(sources.map(file => download(`https://raw.githubusercontent.com/sparkle-project/Sparkle/${version}/sparkle-cli/${file}`, path.join(temp, file))));
    // Keep the official updater logic; expose the probe's version as a single
    // stdout line so the editor need not parse localized human diagnostics.
    const driver = path.join(temp, 'SPUCommandLineDriver.m');
    const source = await fs.readFile(driver, 'utf8');
    const probe = 'if (_probingForUpdates) {';
    if (!source.includes(probe)) throw new Error('Sparkle CLI probe integration has changed');
    await fs.writeFile(driver, source.replace(probe, probe + '\n        fprintf(stdout, "%s\\n", item.displayVersionString.UTF8String);'));
    const contents = path.join(root, '.release-runtime/sparkle.app/Contents');
    await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await fs.mkdir(path.join(contents, 'Frameworks'));
    // cp preserves the framework's versioned symlinks.
    run('cp', ['-R', path.join(sdk, 'Sparkle.framework'), path.join(contents, 'Frameworks')]);
    await fs.copyFile(path.join(sdk, 'LICENSE'), path.join(contents, 'Sparkle-LICENSE'));
    await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.mertdemirtas.singularity.updater</string>
<key>CFBundleExecutable</key><string>sparkle</string><key>CFBundleName</key><string>Singularity Updater</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${version}</string>
<key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
    run('clang', ['-fobjc-arc', '-DSPU_OBJC_DIRECT=__attribute__((objc_direct))',
      '-DSPU_OBJC_DIRECT_MEMBERS=__attribute__((objc_direct_members))',
      '-mmacosx-version-min=12.0', '-F', sdk, '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'Sparkle',
      '-Wl,-rpath,@executable_path/../Frameworks', ...sources.filter(file => file.endsWith('.m')).map(file => path.join(temp, file)),
      '-o', path.join(contents, 'MacOS/sparkle')]);
    run('codesign', ['--force', '--deep', '--sign', '-', path.dirname(contents)]);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
