'use strict';

const path = require('node:path');
const { runIconsTool } = require('app-builder-lib/out/toolsets/icons');

// Passing the original PNG directly to electron-builder preserves its unusual
// dimensions. Hicolor themes only discover icons in their declared size folders.
const root = path.resolve(__dirname, '..');
runIconsTool({
  inputFile: path.join(root, 'assets/singularity-icon.png'),
  outputFormat: 'set',
  outDir: path.join(root, '.release-runtime/icons')
}).catch(error => {
  console.error('Could not prepare Linux application icons:', error);
  process.exitCode = 1;
});
