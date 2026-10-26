#!/usr/bin/env node
'use strict';
const net = require('node:net'), readline = require('node:readline'), os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
function parse(args) {
  const value = { port: undefined, username: undefined, keyPath: undefined }; let destination;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { if (destination || i + 2 !== args.length) return; destination = args[++i]; break; }
    if (arg === '-p' || arg === '-i' || arg === '-l') { if (!args[i + 1]) throw Error('Missing value for ' + arg); value[{ '-p': 'port', '-i': 'keyPath', '-l': 'username' }[arg]] = args[++i]; }
    else if (/^-[il].+/.test(arg)) value[arg[1] === 'i' ? 'keyPath' : 'username'] = arg.slice(2);
    else if (/^-p\d+$/.test(arg)) value.port = arg.slice(2);
    else if (arg.startsWith('-')) return;
    else if (!destination) destination = arg;
    else return; // Remote commands and advanced SSH options use system OpenSSH.
  }
  if (!destination) return;
  const at = destination.lastIndexOf('@');
  value.host = at < 0 ? destination : destination.slice(at + 1);
  value.explicitUser = Boolean(value.username) || at >= 0;
  value.username ||= at < 0 ? os.userInfo().username : destination.slice(0, at);
  value.host = value.host.replace(/^\[|\]$/g, '');
  if (!value.host || /[\s/\\\0]/.test(value.host)) throw Error('Enter a host, such as ssh user@example.com.');
  return value;
}
function system(args) {
  const env = { ...process.env, PATH: process.env.SINGULARITY_SSH_ORIGINAL_PATH || process.env.PATH };
  delete env.SINGULARITY_SSH_PORT; delete env.SINGULARITY_SSH_TOKEN;
  const child = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', args, { env, stdio: 'inherit' });
  child.on('error', error => { console.error('System SSH is unavailable: ' + error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
function configured(input) {
  // Read the user's OpenSSH aliases without opening a network connection.
  const env = { ...process.env, PATH: process.env.SINGULARITY_SSH_ORIGINAL_PATH || process.env.PATH };
  const result = spawnSync(process.platform === 'win32' ? 'ssh.exe' : 'ssh', ['-G', `${input.explicitUser ? input.username + '@' : ''}${input.host}`], { env, encoding: 'utf8', windowsHide: true, timeout: 3000 });
  if (!result.error && result.status === 0) {
    const lines = result.stdout.split('\n').map(line => line.split(/\s+(.+)/s));
    const get = key => lines.find(([name]) => name === key)?.[1]?.trim();
    if (['proxyjump', 'proxycommand'].some(key => get(key) && get(key) !== 'none')) return;
    input.host = get('hostname') || input.host; input.port ||= get('port');
    if (!input.explicitUser) input.username = get('user') || input.username;
    const expand = text => text.replace(/%[dhrp]/g, token => ({ '%d': os.homedir(), '%h': input.host, '%r': input.username, '%p': input.port || '22' }[token]));
    const agent = get('identityagent'); input.agent = agent === 'none' ? false : agent && agent !== 'SSH_AUTH_SOCK' ? expand(agent) : undefined;
    input.keyPaths = lines.filter(([name]) => name === 'identityfile').map(([, value]) => expand(value.trim()));
  }
  input.port = Number(input.port || 22); return input;
}
function prompt(message, secret) {
  process.stdout.write(message);
  if (!process.stdin.isTTY) {
    const reader = readline.createInterface({ input: process.stdin });
    return new Promise(resolve => reader.once('line', line => { reader.close(); resolve(line); }));
  }
  return new Promise((resolve, reject) => {
    let text = '', escape = false; process.stdin.setRawMode(true); process.stdin.resume();
    const finish = (error, value) => { process.stdin.removeListener('data', data); process.stdin.setRawMode(false); process.stdout.write('\r\n'); error ? reject(error) : resolve(value); };
    const data = bytes => { for (const char of bytes.toString()) {
      if (escape) { if (/[A-Za-z~]/.test(char)) escape = false; continue; }
      if (char === '\x1b') { escape = true; continue; }
      if (char === '\x03') { finish(Error('SSH cancelled.')); return; }
      if (char === '\r' || char === '\n') { finish(undefined, text); return; }
      if (char === '\x7f' || char === '\b') { if (text) { text = [...text].slice(0, -1).join(''); if (!secret) process.stdout.write('\b \b'); } }
      else if (char >= ' ') { text += char; if (!secret) process.stdout.write(char); }
    } };
    process.stdin.on('data', data);
  });
}
async function main() {
  let input = parse(process.argv.slice(2));
  if (!input || !process.env.SINGULARITY_SSH_PORT || !process.env.SINGULARITY_SSH_TOKEN) {
    if (!input && process.env.SINGULARITY_SSH_PORT && process.argv.length > 2) console.error('Using system SSH for these options; automatic remote files are not attached.');
    system(process.argv.slice(2)); return;
  }
  input = configured(input); if (!input) { console.error('Using system SSH for this configuration; automatic remote files require a direct SSH connection.'); system(process.argv.slice(2)); return; }
  const socket = net.connect(Number(process.env.SINGULARITY_SSH_PORT), '127.0.0.1'); socket.setEncoding('utf8');
  const send = value => socket.write(JSON.stringify(value) + '\n');
  let buffer = '', streaming = false, finished = false;
  const data = bytes => { if (streaming) send({ type: 'input', data: bytes.toString('base64') }); };
  const resize = () => send({ type: 'resize', cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
  const cleanup = () => { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.removeListener('data', data); process.stdin.pause(); process.stdout.removeListener('resize', resize); };
  socket.on('connect', () => send({ type: 'start', token: process.env.SINGULARITY_SSH_TOKEN, input, cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }));
  socket.on('data', bytes => {
    buffer += bytes.toString();
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let frame; try { frame = JSON.parse(line); } catch { socket.destroy(); return; }
      if (frame.type === 'prompt') prompt(frame.message, frame.secret).then(value => send({ type: 'answer', id: frame.id, value }), error => { console.error(error.message); socket.end(); });
      else if (frame.type === 'ready') { streaming = true; if (process.stdin.isTTY) process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', data); process.stdout.on('resize', resize); }
      else if (frame.type === 'output') { if (!process.stdout.write(Buffer.from(frame.data, 'base64'))) { socket.pause(); process.stdout.once('drain', () => socket.resume()); } }
      else if (frame.type === 'error') { console.error('\r\n' + frame.message); process.exitCode = 1; }
      else if (frame.type === 'exit') { finished = true; cleanup(); console.log('\r\nSSH shell closed. Remote files stay connected until you disconnect SSH or close the IDE.'); socket.end(); }
    }
  });
  socket.on('error', error => { console.error('\r\nSSH connection to the IDE failed: ' + error.message); process.exitCode = 1; });
  socket.on('close', () => { cleanup(); if (!finished) process.exitCode = 1; });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, configured };
