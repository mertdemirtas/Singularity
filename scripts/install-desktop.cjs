'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'linux') throw new Error('The desktop launcher is for Linux.');
const root = path.resolve(__dirname, '..');
const quote = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/%/g, '%%')}"`;
const directory = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'applications');
const target = path.join(directory, 'singularity.desktop');
const desktop = `[Desktop Entry]
Type=Application
Name=Singularity
Comment=A quiet editor for notes and code
Exec=${quote(process.execPath)} ${quote(path.join(root, 'scripts/launch-desktop.cjs'))}
Path=${root}
Icon=${path.join(root, 'assets/singularity-icon.png')}
Terminal=false
Categories=Development;TextEditor;
StartupWMClass=singularity
StartupNotify=true
`;
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(target, desktop, { mode: 0o644 });
console.log(`Installed Singularity launcher: ${target}`);
