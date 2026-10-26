'use strict';
// Theia's local workspace serializer forces every folder to the file scheme.
// Preserve SSH URIs while delegating all local path handling to Theia.
function preserveSshFolders(transform) {
  return (data, workspace) => ({ ...data, folders: data.folders.flatMap(folder =>
    /^ssh:\/\//i.test(folder.path) ? [{ ...folder }] : transform({ folders: [{ ...folder }] }, workspace).folders) });
}
module.exports = { preserveSshFolders };
