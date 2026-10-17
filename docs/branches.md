# Development guide

For normal installation, use the [installation guide](releases.md).

## Branches

- `main`: stable releases.
- `development`: shared development and integration.
- `windows`: Windows compatibility work.
- `macos`: macOS compatibility work.

Start shared work from `development`. Merge platform fixes into it before promoting a verified version to `main`.

## Build from source

Use Git and Node.js 24.21.0 with npm. Install dependencies on the target operating system; do not copy `node_modules` between systems or architectures.

For platform prerequisites and setup commands, see [Windows](windows.md) or [macOS](macos.md). On Ubuntu, install the build tools first:

```sh
sudo apt-get install -y git python3 build-essential libsecret-1-dev libx11-dev libxkbfile-dev libkrb5-dev
```

Then clone, build, and launch:

```sh
git clone --branch development https://github.com/mertdemirtas/Singularity.git
cd Singularity
npm run setup
npm run desktop
```

If the Linux launcher reports a sandbox-helper permission error, run these commands from the project folder, then launch again:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Keep Electron sandboxing enabled.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run desktop` | Launch the desktop app |
| `npm run build` | Rebuild for development |
| `npm run build:release` | Create an optimized build |
| `npm run check` | Check Theia dependency versions |
| `npm run package:release` | Build the current system's installer into `release/` |
| `npm run package:dir` | Build an unpacked app for debugging |

CI checks Linux x64, Windows x64, and macOS on Intel and Apple Silicon. Local test files, dependencies, downloaded extensions, and generated builds stay excluded from Git.

## Publish a release

1. Integrate changes into `development`. Update the version in `package.json` and `package-lock.json`, the release notes, and installation examples.
2. Run **Installers and updates** with publishing disabled. All native installation, update, restart, and recovery checks must pass.
3. Fast-forward `main` to that verified commit.
4. Run **Publish verified installers** on `main` with the successful run's numeric ID. It verifies the commit and checksums, creates the version tag, and publishes the tested installers.

Publish fixes under a higher version; do not replace an existing release's files.

### macOS update signing

GitHub Actions secret `SPARKLE_PRIVATE_KEY` holds the Ed25519 private key. Its public key is stored in `assets/update-key.json`.

Keep a secure backup of the private key. Existing Mac installations need it to trust future updates. The maintainer's local backup is `~/.config/singularity-release-keys/sparkle-private.pem`, with owner-only permissions. Never commit or log the private key, and do not replace the public key without planning key rotation.

Sparkle update signatures are separate from Apple Developer ID signing and notarization. The current Windows and macOS installers are not publisher-signed.
