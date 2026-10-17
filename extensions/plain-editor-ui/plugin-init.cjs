'use strict';

const path = require('node:path');
const { adaptGitHubApi } = require('./plugin-api-compat.cjs');
// Reuse the bundled initializer, including its per-extension API isolation and
// CommonJS/ESM loaders. Installed extension files are never modified.
const upstream = require(path.join(__dirname, '../../lib/backend/plugin-vscode-init.js'));

exports.doInitialization = (factory, plugin) => upstream.doInitialization(
  current => adaptGitHubApi(factory(current), current), plugin
);
