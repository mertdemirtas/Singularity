'use strict';

async function startupSnapshot(model) {
  if (!model) throw new Error('Git is unavailable. Check that the built-in Git extension is enabled.');
  if (model.state === 'uninitialized') await new Promise(resolve => {
    const listener = model.onDidChangeState(state => {
      if (state === 'initialized') { listener.dispose(); resolve(); }
    });
    if (model.state === 'initialized') { listener.dispose(); resolve(); }
  });
  await Promise.all(model.repositories.map(repository => repository.status()));
  return model.repositories.map(repository => ({ root: repository.rootUri.toString(), groups: {
    index: repository.state.indexChanges.length, workingTree: repository.state.workingTreeChanges.length,
    untracked: repository.state.untrackedChanges.length, merge: repository.state.mergeChanges.length
  } }));
}

// Git's plugin model and its frontend resource groups cross an asynchronous RPC
// boundary. Wait for both; a registered command alone does not mean data arrived.
function waitForResources(scm, snapshot, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const listeners = [], watched = new Set();
    let timer;
    const finish = error => {
      clearTimeout(timer); listeners.splice(0).forEach(listener => listener.dispose());
      error ? reject(error) : resolve();
    };
    const check = () => {
      const repositories = scm.repositories.filter(repository => repository.provider.id === 'git');
      for (const repository of repositories) if (!watched.has(repository)) {
        watched.add(repository); listeners.push(repository.provider.onDidChange(check));
      }
      if (snapshot.every(expected => {
        const repository = repositories.find(repository => repository.provider.rootUri === expected.root);
        return repository && Object.entries(expected.groups).every(([id, count]) =>
          (repository.provider.groups.find(group => group.id === id)?.resources.length || 0) === count);
      })) finish();
    };
    listeners.push(scm.onDidAddRepository(check), scm.onDidRemoveRepository(check));
    timer = setTimeout(() => finish(new Error('Git data did not finish restoring. Retry to reload the repository.')), timeout);
    check();
  });
}

module.exports = { startupSnapshot, waitForResources };
