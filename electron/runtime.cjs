'use strict';

const path = require('node:path');
const { existsSync } = require('node:fs');

function backendRuntime({ packaged, resourcesPath, env = process.env, platform = process.platform }) {
  const runtime = path.join(resourcesPath, 'runtime');
  const bin = platform === 'win32' ? runtime : path.join(runtime, 'bin');
  const node = packaged ? path.join(bin, platform === 'win32' ? 'node.exe' : 'node') : env.npm_node_execpath || 'node';
  if (packaged && !existsSync(node)) throw new Error('The bundled Node runtime is missing. Reinstall Singularity.');
  const variables = { ...env, npm_node_execpath: node };
  delete variables.ELECTRON_RUN_AS_NODE;
  if (packaged) {
    const key = Object.keys(variables).find(key => key.toLowerCase() === 'path') || 'PATH';
    variables[key] = [bin, variables[key]].filter(Boolean).join(platform === 'win32' ? ';' : ':');
    variables.npm_execpath = path.join(runtime, 'npm/bin/npm-cli.js');
  }
  if (platform !== 'win32' && !variables.SHELL) variables.SHELL = platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return { node, env: variables };
}

module.exports = { backendRuntime };
