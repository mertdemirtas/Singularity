'use strict';
const net = require('node:net'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { call } = require('./ssh-connections.cjs');
const quote = text => `'${text.replace(/'/g, `'\\''`)}'`;
class SshTerminalBridge {
  constructor(connections, client) {
    this.connections = connections; this.client = client; this.token = randomBytes(32).toString('hex'); this.sockets = new Set();
    this.ready = this.start();
  }
  async start() {
    this.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-ssh-bin-'));
    const script = path.join(process.cwd(), 'extensions/plain-editor-ui/ssh-cli.cjs');
    await fs.writeFile(path.join(this.directory, 'ssh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o700 });
    await fs.writeFile(path.join(this.directory, 'ssh.cmd'), `@echo off\r\n"${process.execPath.replace(/%/g, '%%')}" "${script.replace(/%/g, '%%')}" %*\r\n`, { mode: 0o700 });
    const zshDirectory = path.join(this.directory, 'zsh'); await fs.mkdir(zshDirectory);
    await fs.writeFile(path.join(zshDirectory, '.zshenv'), `# Preserve the user's startup files; only intercept SSH in this IDE terminal.
if [ -n "$SINGULARITY_SSH_ORIGINAL_ZDOTDIR" ]; then
  export ZDOTDIR="$SINGULARITY_SSH_ORIGINAL_ZDOTDIR"
else
  unset ZDOTDIR
fi
if [ -r "\${ZDOTDIR:-$HOME}/.zshenv" ]; then . "\${ZDOTDIR:-$HOME}/.zshenv"; fi
ssh() { command "$SINGULARITY_SSH_BIN/ssh" "$@"; }
`, { mode: 0o600 });
    this.server = net.createServer(socket => this.accept(socket));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    return { directory: this.directory, port: this.server.address().port, token: this.token, zshDirectory, executable: process.execPath, cli: script, cwd: require('node:url').pathToFileURL(os.homedir()).href };
  }
  accept(socket) {
    if (this.disposed) { socket.destroy(); return; }
    this.sockets.add(socket); socket.setNoDelay(true); socket.setEncoding('utf8');
    let buffer = '', started = false, channel, session, pendingId, previouslyConnected; const answers = new Map();
    const send = frame => new Promise((resolve, reject) => socket.write(JSON.stringify(frame) + '\n', error => error ? reject(error) : resolve()));
    const ask = (message, secret = false) => new Promise((resolve, reject) => {
      const id = randomUUID(); answers.set(id, { resolve, reject }); send({ type: 'prompt', id, message, secret }).catch(reject);
    });
    const timeout = setTimeout(() => { if (!started) socket.destroy(); }, 5000);
    socket.on('close', () => { clearTimeout(timeout); this.sockets.delete(socket); channel?.close(); if (!channel && pendingId && !previouslyConnected) this.connections.disconnect(pendingId); for (const pending of answers.values()) pending.reject(Error('SSH terminal closed.')); answers.clear(); });
    socket.on('error', () => {});
    const connect = async frame => {
      let input = frame.input || {};
      const profiles = await this.connections.profiles();
      const saved = input.profileId && profiles.find(value => value.id === input.profileId);
      if (input.profileId && !saved) throw Error('This saved SSH connection no longer exists.');
      if (saved) input = { ...saved, keyPaths: [], agent: saved.auth === 'agent' ? saved.agentSocket : false };
      const existing = saved || profiles.find(value => value.host === input.host && value.username === input.username && value.port === input.port);
      const value = { ...input, id: existing?.id || randomUUID(), folder: saved?.folder || '~', name: saved?.name || `${input.username}@${input.host}`, auth: input.keyPath ? 'key' : 'password' };
      pendingId = value.id; previouslyConnected = this.connections.sessions.has(value.id);
      let verifiedKey;
      const interactions = {
        confirmHost: async details => {
          if (verifiedKey && verifiedKey !== details.fingerprint) throw Error('The host key changed while authenticating.');
          if (verifiedKey) return true;
          const accepted = /^(yes|y)$/i.test(await ask(`The authenticity of ${details.host}:${details.port} cannot be established.\r\n${details.fingerprint}\r\nTrust this host (yes/no)? `));
          if (accepted) verifiedKey = details.fingerprint; return accepted;
        },
        credentials: async profile => profile.auth === 'key' ? { passphrase: await ask('Key passphrase: ', true) } : { password: await ask(`${profile.username}@${profile.host}'s password: `, true) }
      };
      // Prefer explicit keys, then an available agent/default OpenSSH keys.
      const attempt = (input, credentials) => { if (socket.destroyed) throw Error('SSH connection was cancelled.'); return this.connections.connect(input, credentials, interactions); };
      let result;
      if (!input.keyPath) {
        if (input.agent !== false && (input.agent || process.env.SSH_AUTH_SOCK || process.platform === 'win32')) {
          try { result = await attempt({ ...value, auth: 'agent', agentSocket: input.agent }, {}); }
          catch (error) { if (/host key|verification|cancelled/i.test(error.message)) throw error; }
        }
        if (!result) for (let keyPath of input.keyPaths || ['~/.ssh/id_ed25519', '~/.ssh/id_rsa', '~/.ssh/id_ecdsa']) {
          keyPath = keyPath.startsWith('~/') ? path.join(os.homedir(), keyPath.slice(2)) : keyPath;
          if (!await fs.stat(keyPath).then(stat => stat.isFile(), () => false)) continue;
          try { result = await attempt({ ...value, auth: 'key', keyPath }, {}); break; }
          catch (error) { if (/host key|verification|cancelled/i.test(error.message)) throw error; }
        }
      }
      if (!result) result = await attempt(value, {});
      if (socket.destroyed) return;
      session = this.connections.sessions.get(result.id);
      channel = await call(session.ssh, 'shell', { term: 'xterm-256color', cols: this.size(frame.cols, 80), rows: this.size(frame.rows, 24) });
      session.shells.set(socket, channel);
      await send({ type: 'ready' });
      const output = async bytes => { channel.pause(); channel.stderr.pause(); try { await send({ type: 'output', data: bytes.toString('base64') }); } catch { channel.close(); } finally { channel.resume(); channel.stderr.resume(); } };
      channel.on('data', output); channel.stderr.on('data', output); channel.on('error', () => channel.close());
      channel.once('close', () => { session.shells.delete(socket); send({ type: 'exit' }).catch(() => socket.destroy()); });
      this.client.remoteConnected(result).catch(error => send({ type: 'error', message: 'SSH connected, but the remote folder could not open: ' + error.message }).catch(() => {}));
    };
    const handle = frame => {
      if (!started) {
        if (frame.type !== 'start' || typeof frame.token !== 'string' || frame.token.length !== this.token.length || !timingSafeEqual(Buffer.from(frame.token), Buffer.from(this.token))) { socket.destroy(); return; }
        started = true; clearTimeout(timeout);
        connect(frame).catch(async error => { try { await send({ type: 'error', message: error.message }); } catch {} socket.end(); });
      } else if (frame.type === 'answer' && answers.has(frame.id)) { answers.get(frame.id).resolve(String(frame.value || '')); answers.delete(frame.id); }
      else if (frame.type === 'input' && channel) { const bytes = Buffer.from(frame.data || '', 'base64'); if (bytes.length > 65536) { socket.destroy(); return; } if (!channel.write(bytes)) { socket.pause(); channel.once('drain', () => socket.resume()); } }
      else if (frame.type === 'resize' && channel) channel.setWindow(this.size(frame.rows, 24), this.size(frame.cols, 80), 0, 0);
    };
    socket.on('data', bytes => { buffer += bytes.toString(); if (buffer.length > 262144) { socket.destroy(); return; } while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { handle(JSON.parse(line)); } catch { socket.destroy(); return; }
    } });
  }
  size(value, fallback) { return Math.max(2, Math.min(500, Number(value) || fallback)); }
  async dispose() { this.disposed = true; await this.ready.catch(() => {}); for (const socket of this.sockets) socket.destroy(); if (this.server) await new Promise(resolve => this.server.close(resolve)); if (this.directory) await fs.rm(this.directory, { recursive: true, force: true }); }
}
module.exports = { SshTerminalBridge };
