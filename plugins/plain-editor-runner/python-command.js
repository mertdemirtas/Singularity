'use strict';

function findPython(execFileSync, platform = process.platform) {
  const candidates = platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [command, args] of candidates) {
    try {
      const version = execFileSync(command, [...args, '-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
      if (version.trim() === '3') return { command, args };
    } catch { /* Try the next conventional Python 3 launcher. */ }
  }
  throw new Error('Install Python 3 and make its launcher available on PATH.');
}

function commandLine(launcher, filename, platform = process.platform) {
  const quote = value => platform === 'win32'
    ? `'${String(value).replace(/'/g, "''")}'`
    : `'${String(value).replace(/'/g, `'\\''`)}'`;
  return `${platform === 'win32' ? '& ' : ''}${[launcher.command, ...launcher.args, '--', filename].map(quote).join(' ')}`;
}

module.exports = { findPython, commandLine };
