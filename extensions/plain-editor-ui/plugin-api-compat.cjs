'use strict';

// GitHub's ordinary PR views currently register proposed Copilot context APIs
// unconditionally. Singularity has no Copilot chat surface, so explicitly skip
// these optional registrations rather than aborting the entire extension.
function adaptGitHubApi(api, plugin, warn = message => console.warn(message)) {
  if (plugin.model.id.toLowerCase() !== 'github.vscode-pull-request-github') return api;
  const missing = ['registerChatAttachContextProvider', 'registerChatTabContextProvider']
    .filter(name => typeof api.chat?.[name] !== 'function');
  if (!missing.length) return api;
  let warned = false;
  const chat = { ...api.chat };
  for (const name of missing) chat[name] = () => {
    if (!warned) {
      warned = true;
      warn('Singularity: GitHub Copilot chat context attachments are unavailable. Optional chat registration was skipped; pull requests and issues remain enabled.');
    }
    return { dispose() {} };
  };
  return { ...api, chat };
}

module.exports = { adaptGitHubApi };
