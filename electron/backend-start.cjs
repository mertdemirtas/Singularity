'use strict';

const net = require('node:net');

function allocatePort(preferred) {
  const candidate = Number.isInteger(preferred) && preferred >= 1024 && preferred <= 65535 ? preferred : 0;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => {
      if (candidate && ['EADDRINUSE', 'EACCES'].includes(error.code)) resolve(allocatePort());
      else reject(error);
    });
    server.listen(candidate, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForBackend(child, port, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
      error ? reject(error) : resolve();
    };
    const onMessage = address => { if (address?.port === port) finish(); };
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`Editor backend exited with code ${code}.`));
    const timer = setTimeout(() => finish(new Error('Editor backend did not start in time.')), timeout);
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

module.exports = { allocatePort, waitForBackend };
