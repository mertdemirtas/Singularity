'use strict';

// Account consent and the selected session belong to the application, not to
// the folder currently open. Tokens remain in the OS credential store.
function authenticationStorage(globalStorage, workspaceStorage) {
  return {
    async getData(key, fallback) {
      if (!key.startsWith('authentication-')) return workspaceStorage.getData(key,fallback);
      const current = await globalStorage.getData(key);
      if (current !== undefined) return current === null ? fallback : current;
      const legacy = await workspaceStorage.getData(key);
      if (legacy !== undefined) await globalStorage.setData(key,legacy);
      return legacy === undefined ? fallback : legacy;
    },
    setData(key, value) {
      // Keep a deletion marker so consent removed by sign-out cannot be
      // restored from another folder's old authentication metadata.
      return key.startsWith('authentication-') ? globalStorage.setData(key,value === undefined ? null : value) : workspaceStorage.setData(key,value);
    }
  };
}

module.exports = {authenticationStorage};
