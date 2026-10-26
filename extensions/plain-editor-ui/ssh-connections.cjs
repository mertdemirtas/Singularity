'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { Client, utils } = require('ssh2');
const { EventEmitter } = require('node:events');

function profile(input) {
  const value = { id: input.id || randomUUID(), name: String(input.name || input.host || '').trim(),
    host: String(input.host || '').trim().replace(/^\[|\]$/g, ''), port: Number(input.port || 22),
    username: String(input.username || '').trim(), auth: input.auth || 'agent',
    ...(typeof input.agentSocket === 'string' && !input.agentSocket.includes('\0') ? { agentSocket: input.agentSocket } : {}),
    keyPath: String(input.keyPath || '').trim(), folder: String(input.folder || '~').trim() || '~' };
  if (!/^[a-f0-9-]{36}$/.test(value.id) || !value.host || /[\s\0/\\]/.test(value.host) || value.host.startsWith('-')) throw Error('Enter a hostname or IP address.');
  if (!value.username || /[\0\r\n]/.test(value.username)) throw Error('Enter the remote username.');
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw Error('SSH port must be between 1 and 65535.');
  if (!['agent', 'key', 'password'].includes(value.auth)) throw Error('Choose SSH agent, private key or password authentication.');
  if (value.auth === 'key' && !value.keyPath) throw Error('Choose a private key file.');
  if (value.folder.includes('\0')) throw Error('Invalid remote folder.');
  return value;
}
const address = value => `${value.host.toLowerCase()}:${value.port}`;
const fingerprint = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
const call = (target, method, ...args) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('The SSH device stopped responding. Reconnect and try again.')), 20000);
  try { target[method](...args, (error, result) => { clearTimeout(timer); error ? reject(error) : resolve(result); }); }
  catch (error) { clearTimeout(timer); reject(error); }
});

class SshConnections extends EventEmitter {
  constructor(store, client = {}, options = {}) {
    super(); this.store = store; this.client = client; this.sessions = new Map(); this.connecting = new Map();
    this.blocked = new Set(); this.pendingClients = new Map(); this.persistence = Promise.resolve(); this.disposed = false; this.timeout = options.timeout || 20000;
  }
  mutate(operation) {
    if (this.store.mutate) return this.store.mutate(operation);
    const update = this.persistence.catch(() => {}).then(() => operation(this.store)); this.persistence = update; return update;
  }
  async profiles() { return (await this.store.get('profiles')) || []; }
  async list() { return (await this.profiles()).map(value => ({ ...value, connected: this.sessions.has(value.id) })); }
  async connect(input, credentials = {}, interactions = this.client) {
    if (this.disposed) throw Error('The SSH session has closed.');
    const value = profile(input);
    const existing = (await this.profiles()).find(saved => saved.id === value.id);
    if (existing && ['host', 'port', 'username'].some(key => existing[key] !== value[key])) throw Error('Save a changed host or username as a new connection.');
    if (this.sessions.has(value.id)) return { ...this.sessions.get(value.id).profile, connected: true };
    if (this.connecting.has(value.id)) return this.connecting.get(value.id);
    this.blocked.delete(value.id);
    const pending = this.establish(value, credentials, interactions);
    this.connecting.set(value.id, pending);
    try { return await pending; } finally { this.connecting.delete(value.id); }
  }
  async establish(value, credentials, interactions) {
    let credentialError, handshakeTimer;
    const pausePrompt = () => clearTimeout(handshakeTimer);
    let restartDeadline = () => {};
    const options = { host: value.host, port: value.port, username: value.username,
      readyTimeout: 0, keepaliveInterval: 15000, keepaliveCountMax: 3 };
    if (value.auth === 'password') {
      let attempted = false;
      options.authHandler = (remaining, partial, next) => {
        if (attempted || (remaining && !remaining.includes('password'))) { next(false); return; }
        attempted = true; pausePrompt();
        Promise.resolve(credentials.password ? credentials : interactions.credentials?.(value)).then(secret => {
          if (!secret?.password) throw Error('SSH sign-in was cancelled.');
          restartDeadline(); next({ type: 'password', username: value.username, password: secret.password });
        }).catch(error => { credentialError = error; next(false); });
      };
    } else if (value.auth === 'key') {
      options.privateKey = await fs.readFile(value.keyPath.startsWith('~/') ? path.join(os.homedir(), value.keyPath.slice(2)) : value.keyPath);
      let parsed = utils.parseKey(options.privateKey, credentials.passphrase);
      if (parsed instanceof Error && !credentials.passphrase && /encrypted|passphrase/i.test(parsed.message)) {
        credentials = await interactions.credentials?.(value) || {};
        parsed = utils.parseKey(options.privateKey, credentials.passphrase);
      }
      if (parsed instanceof Error) throw Error('Could not read the SSH key: ' + parsed.message);
      options.passphrase = credentials.passphrase;
    } else {
      options.agent = value.agentSocket || process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
      if (!options.agent) throw Error('No SSH agent is available. Choose a private key or password instead.');
    }
    const hosts = (await this.store.get('hosts')) || {};
    let acceptedKey, verificationError;
    options.hostVerifier = (key, done) => {
      acceptedKey = fingerprint(key);
      if (hosts[address(value)]) {
        if (hosts[address(value)] !== acceptedKey) verificationError = Error('The SSH host key has changed. Verify the device, then forget the saved connection before trusting its new key.');
        done(!verificationError); return;
      }
      pausePrompt();
      Promise.resolve(interactions.confirmHost?.({ host: value.host, port: value.port, fingerprint: acceptedKey }))
        .then(accepted => { if (!accepted) verificationError = Error('SSH host verification was cancelled.'); restartDeadline(); done(Boolean(accepted)); }, error => { verificationError = error; done(false); });
    };
    const ssh = new Client(); this.pendingClients.set(value.id, ssh);
    const session = { ssh, profile: value, shells: new Map(), alive: true };
    // Always retain an error listener, including after handshake completion.
    ssh.on('error', error => { session.error = error; });
    ssh.once('close', () => {
      session.alive = false;
      if (this.sessions.get(value.id) === session) { this.sessions.delete(value.id); this.emit('disconnected', value.id); this.changed(); }
    });
    try {
      await new Promise((resolve, reject) => {
        restartDeadline = () => { clearTimeout(handshakeTimer); handshakeTimer = setTimeout(() => { ssh.destroy(); reject(Error('SSH connection timed out. Check the host, port and network.')); }, this.timeout); };
        restartDeadline();
        const ready = () => { cleanup(); resolve(); };
        const failed = error => { cleanup(); reject(verificationError || credentialError || error || Error('SSH connection closed.')); };
        const cleanup = () => { clearTimeout(handshakeTimer); ssh.removeListener('ready', ready); ssh.removeListener('error', failed); ssh.removeListener('close', failed); };
        ssh.once('ready', ready); ssh.once('error', failed); ssh.once('close', failed);
        try { ssh.connect(options); ssh.setNoDelay(true); } catch (error) { failed(error); }
      });
      session.sftp = await call(ssh, 'sftp');
      const home = await call(session.sftp, 'realpath', '.');
      const folder = value.folder === '~' ? home : value.folder.startsWith('~/') ? path.posix.join(home, value.folder.slice(2)) : value.folder.startsWith('/') ? value.folder : path.posix.join(home, value.folder);
      value.folder = await call(session.sftp, 'realpath', folder);
      if (!(await call(session.sftp, 'stat', value.folder)).isDirectory()) throw Error('The remote path is not a folder.');
      if (this.disposed || !session.alive || this.blocked.has(value.id)) throw Error('SSH connection was cancelled.');
      // Persist only connection details and the verified public host fingerprint.
      await this.mutate(async store => {
        const profiles = (await store.get('profiles')) || [], known = (await store.get('hosts')) || {};
        if (known[address(value)] && known[address(value)] !== acceptedKey) throw Error('The SSH host key changed during connection.');
        await store.set('hosts', { ...known, [address(value)]: acceptedKey });
        await store.set('profiles', [...profiles.filter(saved => saved.id !== value.id), value]);
      });
      if (this.disposed || !session.alive || this.blocked.has(value.id)) throw Error('SSH connection was cancelled.');
      this.sessions.set(value.id, session); this.changed();
      return { ...value, connected: true };
    } catch (error) { ssh.destroy(); throw error; }
    finally { this.pendingClients.delete(value.id); }
  }
  changed() { this.client.connectionChanged?.().catch?.(() => {}); }
  async get(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    if (this.blocked.has(id)) throw Error('SSH is disconnected. Reconnect from the terminal with ssh user@host.');
    throw Error('SSH is offline. Connect from the terminal with ssh user@host.');
  }
  disconnect(id) {
    this.blocked.add(id); this.pendingClients.get(id)?.destroy();
    const session = this.sessions.get(id);
    if (session) { this.sessions.delete(id); for (const channel of session.shells.values()) channel.close(); session.ssh.end(); this.emit('disconnected', id); this.changed(); }
  }
  async forget(id) {
    this.disconnect(id);
    await this.mutate(async store => {
      const profiles = (await store.get('profiles')) || [], removed = profiles.find(value => value.id === id), kept = profiles.filter(value => value.id !== id);
      await store.set('profiles', kept);
      if (removed && !kept.some(value => address(value) === address(removed))) {
        const hosts = { ...((await store.get('hosts')) || {}) }; delete hosts[address(removed)]; await store.set('hosts', hosts);
      }
    });
  }
  dispose() { this.disposed = true; for (const client of this.pendingClients.values()) client.destroy(); this.pendingClients.clear(); for (const id of this.sessions.keys()) this.disconnect(id); this.removeAllListeners(); }
}
module.exports = { SshConnections, profile, fingerprint, call };
