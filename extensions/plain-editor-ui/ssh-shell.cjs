'use strict';
function terminalEnvironment(input, connection, shellPath) {
  const env = { ...input }, originalPath = env.SINGULARITY_SSH_ORIGINAL_PATH || env.PATH || env.Path || connection.originalPath;
  delete env.Path;
  // Login scripts such as macOS path_helper can put system SSH ahead of PATH.
  env.SINGULARITY_SSH_BIN = connection.directory;
  if (connection.platform !== 'win32') env['BASH_FUNC_ssh%%'] = '() { command "$SINGULARITY_SSH_BIN/ssh" "$@"; }';
  if (/(^|[\\/])zsh$/.test(shellPath)) {
    env.SINGULARITY_SSH_ORIGINAL_ZDOTDIR = env.SINGULARITY_SSH_ORIGINAL_ZDOTDIR ?? env.ZDOTDIR ?? connection.zdotdir;
    env.ZDOTDIR = connection.zshDirectory;
  }
  return { ...env, PATH: connection.directory + connection.delimiter + originalPath,
    SINGULARITY_SSH_ORIGINAL_PATH: originalPath, SINGULARITY_SSH_PORT: String(connection.port), SINGULARITY_SSH_TOKEN: connection.token };
}
module.exports = { terminalEnvironment };
