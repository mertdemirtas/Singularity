'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'lib/frontend/bundle.css');
const scriptPath = path.join(root, 'lib/frontend/bundle.js');
const htmlPath = path.join(root, 'lib/frontend/index.html');
const themePath = path.join(root, 'styles/plain-editor.css');
const marker = '/* Plain Editor theme */';

if (!fs.existsSync(bundlePath)) {
  throw new Error('Build Theia before applying the Plain Editor theme.');
}

const bundle = fs.readFileSync(bundlePath, 'utf8');
if (!bundle.includes(marker)) {
  // Keep the app theme together before the generated Theia styles.
  fs.writeFileSync(bundlePath, `${marker}\n${fs.readFileSync(themePath, 'utf8')}\n${bundle}`);
}

const version = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex').slice(0, 12);
const html = fs.readFileSync(htmlPath, 'utf8')
  .replace(/\.\/bundle\.css(?:\?v=[a-f0-9]+)?/g, `./bundle.css?v=${version(bundlePath)}`)
  .replace(/\.\/bundle\.js(?:\?v=[a-f0-9]+)?/g, `./bundle.js?v=${version(scriptPath)}`);
fs.writeFileSync(htmlPath, html);
