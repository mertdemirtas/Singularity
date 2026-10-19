'use strict';

// The desktop backend and its plugin hosts must not outlive Electron, including
// after a crash or forced exit where app's will-quit callback never runs.
function watchParent({ host = process, delay = 1500 } = {}) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (host.platform === 'win32') {
      require('node:child_process').spawnSync('taskkill.exe', ['/PID', String(host.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
      host.exit(0);
    } else {
      // Electron starts this backend in its own process group.
      const force = setTimeout(() => { try { host.kill(-host.pid, 'SIGKILL'); } catch { host.exit(0); } }, delay);
      force.unref();
      try { host.kill(-host.pid, 'SIGTERM'); } catch { host.exit(0); }
    }
  };
  host.once('disconnect', stop);
  return () => host.removeListener('disconnect', stop);
}

if (require.main === module) {
  const entry = process.argv.splice(2, 1)[0];
  if (!entry || !process.send) throw new Error('The editor backend requires its desktop parent.');
  watchParent();
  process.argv[1] = entry;
  require(entry);
}
module.exports = { watchParent };
