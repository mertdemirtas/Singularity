'use strict';

const FONT_FALLBACKS = {
  win32: ['monospace', 'Consolas', 'Cascadia Mono', 'Courier New'],
  darwin: ['monospace', 'Menlo', 'Monaco', 'SFMono-Regular', 'Courier'],
  linux: ['monospace', 'DejaVu Sans Mono', 'Ubuntu Mono']
};

async function installedFonts(execFile, platform = process.platform) {
  try {
    let names;
    if (platform === 'win32') {
      const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
        + 'Add-Type -AssemblyName System.Drawing; '
        + '@((New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }) | ConvertTo-Json -Compress';
      const { stdout } = await execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      const value = JSON.parse(stdout.replace(/^\uFEFF/, ''));
      names = Array.isArray(value) ? value : [value];
    } else if (platform === 'darwin') {
      const script = "ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))";
      const { stdout } = await execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      names = JSON.parse(stdout);
    } else {
      const { stdout } = await execFile('fc-list', ['-f', '%{family}\n', ':spacing=mono'], { timeout: 4000, maxBuffer: 1024 * 1024 });
      names = stdout.split(/\r?\n/).flatMap(name => name.split(','));
    }
    const valid = names.filter(name => typeof name === 'string').map(name => name.trim()).filter(name => name && name.length < 160);
    if (valid.length) return [...new Set(valid)].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.warn(`Singularity: font discovery unavailable (${platform}): ${error.message}`);
  }
  return FONT_FALLBACKS[platform] || FONT_FALLBACKS.linux;
}

function windowOptions(platform = process.platform) {
  return {
    transparent: platform === 'linux',
    backgroundColor: platform === 'linux' ? '#00000000' : '#f5f5f5',
    roundedCorners: true,
    ...(platform === 'win32' ? { thickFrame: true } : {})
  };
}

module.exports = { installedFonts, windowOptions, FONT_FALLBACKS };
