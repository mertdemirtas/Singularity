'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    // An exited Linux child can remain a zombie until its new parent reaps it.
    return process.platform !== 'linux' || !/^\d+ \(.+\) Z /.test(fs.readFileSync('/proc/' + pid + '/stat', 'utf8'));
  } catch { return false; }
};
test('losing the desktop parent terminates the actual backend and its child process', { timeout: 15000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'singularity-process-unit-'));
  const entry = path.join(directory, 'backend-fixture.cjs');
  fs.writeFileSync(entry, `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.send({child:child.pid});setInterval(()=>{},1000);`);
  const backend = spawn(process.execPath, [path.resolve(__dirname, '../../electron/backend-process.cjs'), entry], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  let child;
  t.after(() => {
    for (const pid of [child, backend.pid]) if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    fs.rmSync(directory, { force: true, recursive: true });
  });
  child = await new Promise((resolve, reject) => { backend.once('message', message => resolve(message.child)); backend.once('error', reject); backend.once('exit', code => reject(new Error('Fixture exited: ' + code))); });
  assert(alive(child));
  backend.disconnect();
  const end = Date.now() + 8000;
  while ((alive(backend.pid) || alive(child)) && Date.now() < end) await pause(50);
  assert(!alive(backend.pid), 'The orphan backend must terminate');
  assert(!alive(child), 'Backend children must not remain running');
});
