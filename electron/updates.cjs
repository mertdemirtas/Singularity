'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

function newer(version, current) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const next = parse(version), previous = parse(current);
  if (!next || !previous) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

class Updates extends EventEmitter {
  constructor({ app, prepare, cancelPreparation, updater, platform = process.platform, resourcesPath = process.resourcesPath,
    probeHelper = promisify(execFile), spawnHelper = spawn }) {
    super();
    Object.assign(this, { app, prepare, cancelPreparation, platform, resourcesPath, probeHelper, spawnHelper });
    this.state = { phase: app.isPackaged ? 'idle' : 'disabled', version: app.getVersion(),
      message: app.isPackaged ? 'Updates are checked on GitHub.' : 'Updates are available in the installed app.' };
    if (app.isPackaged && platform !== 'darwin') {
      this.updater = updater || require('electron-updater').autoUpdater;
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.allowDowngrade = false;
      this.updater.allowPrerelease = false;
      if (platform === 'win32') {
        this.updater.disableWebInstaller = true;
        this.updater.installDirectory = path.dirname(app.getPath('exe'));
      }
      if (platform === 'linux') this.updater.doInstall = options => {
        try {
          require('./install-deb.cjs').installDeb({ filename: this.updater.downloadedUpdateHelper?.file,
            version: this.state.availableVersion });
          if (options.isForceRunAfter) this.updater.app.relaunch();
          return true;
        } catch (error) { this.fail(error); return false; }
      };
      this.updater.on('update-available', info => this.set({ phase: 'available', availableVersion: info.version,
        message: `Singularity ${info.version} is available.` }));
      this.updater.on('update-not-available', () => this.set({ phase: 'current', availableVersion: undefined, message: 'Singularity is up to date.' }));
      this.updater.on('download-progress', info => this.set({ phase: 'downloading', percent: Math.floor(info.percent),
        message: `Downloading update… ${Math.floor(info.percent)}%` }));
      // Operations handle rejections and keep the editor open. An error listener
      // also prevents EventEmitter's special unhandled-error behavior.
      this.updater.on('error', error => {
        console.error('Singularity update:', error);
        if (this.state.phase === 'installing') this.fail(error);
      });
    }
  }

  set(change) { this.state = { ...this.state, ...change }; this.emit('state', this.state); return this.state; }
  get busy() { return ['checking', 'downloading', 'preparing', 'installing'].includes(this.state.phase); }
  fail(error) {
    this.cancelPreparation();
    return this.set({ phase: 'error', message: `Update failed: ${error.message}. Your editor remains open. Try again.` });
  }

  async check() {
    if (!this.app.isPackaged || this.busy) return this.state;
    this.set({ phase: 'checking', message: 'Checking GitHub for updates…', percent: undefined });
    try {
      if (this.platform !== 'darwin') await this.updater.checkForUpdates();
      else {
        let version;
        try {
          const result = await this.probeHelper(this.macExecutable, [this.macBundle, '--probe',
            '--allow-major-upgrades', '--user-agent-name', 'Singularity'], { timeout: 45000, maxBuffer: 65536 });
          version = result.stdout.trim();
        } catch (error) { if (error.code !== 4) throw new Error(error.stderr?.trim() || error.message); }
        if (version && newer(version, this.state.version)) {
          this.set({ phase: 'available', availableVersion: version, message: `Singularity ${version} is available.` });
        } else this.set({ phase: 'current', availableVersion: undefined, message: 'Singularity is up to date.' });
      }
    } catch (error) { this.fail(error); }
    return this.state;
  }

  get macExecutable() { return path.join(this.resourcesPath, 'runtime/sparkle.app/Contents/MacOS/sparkle'); }
  get macBundle() { return path.resolve(this.resourcesPath, '../..'); }

  async install() {
    if (!this.app.isPackaged || this.busy) return this.state;
    if (!this.state.availableVersion) { await this.check(); if (this.state.phase !== 'available') return this.state; }
    try {
      if (this.platform !== 'darwin') {
        this.set({ phase: 'downloading', message: 'Downloading update…', percent: 0 });
        await this.updater.downloadUpdate();
      }
      this.set({ phase: 'preparing', message: 'Preserving your open documents…' });
      await this.prepare();
      this.set({ phase: 'installing', message: 'Installing update and restarting…' });
      if (this.platform !== 'darwin') this.updater.quitAndInstall(true, true);
      else {
        const helper = this.spawnHelper(this.macExecutable, [this.macBundle, '--check-immediately', '--interactive', '--allow-major-upgrades',
          '--user-agent-name', 'Singularity'], { detached: true, stdio: 'ignore' });
        helper.once('error', error => this.fail(error));
        helper.once('exit', code => {
          // Successful installation terminates this application first. If we
          // are still running, restore the editor even when no update was found.
          this.fail(new Error(`macOS updater exited before restarting (code ${code})`));
        });
        helper.unref();
      }
    } catch (error) { this.fail(error); }
    return this.state;
  }

  start() {
    if (!this.app.isPackaged || this.timer) return;
    this.initial = setTimeout(() => this.check(), 10000);
    this.timer = setInterval(() => this.check(), 4 * 60 * 60 * 1000);
    this.initial.unref(); this.timer.unref();
  }
  dispose() { clearTimeout(this.initial); clearInterval(this.timer); }
}

module.exports = { Updates, newer };
