# Branches and platform compatibility

## Recommended structure

- `main`: stable releases that have passed the native platform checks.
- `development`: the shared application code and integration branch.
- `windows`: Windows compatibility work, created from `development`.
- `macos`: macOS compatibility work, created from `development`.

Treat the OS branches as working branches, not permanent copies of the product.
Share portability fixes between them, then merge reviewed compatibility changes
into `development` once their checks pass. Promote a tested version to `main`.
Future fixes should use short branches from `development` and run the same OS
matrix. Keep platform-specific code in small runtime adapters rather than
maintaining three separate implementations of the editor.

The verified compatibility work is integrated into `development`. Shared
features, including document recovery, continue there. The OS branches remain
available for platform-specific work; `main` remains the release branch.

## Native checks

The compatibility workflow builds and launches the existing app on Linux x64,
Windows x64, Apple Silicon macOS, and Intel macOS. It checks native Node modules,
font discovery, a file whose path contains spaces, the OS save shortcut, and
the Python runner's terminal output. Recovery checks force two crashes and
relaunch the app, verifying named files, empty documents, untitled notes,
Unicode and CRLF text, unchanged originals, Save As, and discard cleanup.
Logs and screenshots are retained as CI artifacts. No local files from
`tests/` are committed or uploaded.

Install dependencies on the target OS. Do not copy `node_modules` between OSes
or architectures. Theia runs with the Node executable that installed its native
dependencies; Electron's renderer remains sandboxed.

These branches provide source installation with `npm run setup` and
`npm run desktop`. Signed installers, Apple notarization, and Windows signing
certificates are separate release work; native checks do not test signed
distribution packages.
