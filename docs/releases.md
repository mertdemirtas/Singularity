# Installation and updates

Download installers from [GitHub Releases](https://github.com/mertdemirtas/Singularity/releases/latest).

| Platform | Installer | Architectures |
| --- | --- | --- |
| Ubuntu/Debian | `.deb` | x64 |
| Windows | `.exe` (per-user NSIS) | x64 |
| macOS 12 and later | `.dmg` (drag to Applications) | Apple Silicon, Intel |

Windows 10 or later and a Linux distribution supported by the bundled Electron version are required. macOS uses separate architecture builds. Linux packaging configures the root-owned Chromium sandbox helper and uses Electron's standard AppArmor integration. Sandboxing remains enabled.

The installer includes Node.js and npm for the editor backend, terminals, and extensions. Project-specific tools such as Git, Python, and compilers must be installed separately. Your settings, extensions, sessions, and local recovery copies stay in the existing profile. Uninstalling the Windows app does not delete that profile.

## Update behavior

Singularity checks **published stable GitHub releases**, ten seconds after the editor starts and every four hours while open. Committing to `main` alone does not publish an update. Use **Menu → Check for updates** or **Settings → Singularity** to check manually.

When a newer release is available, choose **Update and restart**. Windows/Linux download and validate the installer using electron-updater; macOS uses Sparkle with Ed25519 archive signatures. Downloads do not start before the user chooses to update. The editor checkpoints unsaved text and its session before installation, then restarts. Unsaved documents reopen as **Recovered** tabs; use Save As to keep them. This preservation also runs when regular crash recovery is disabled. Failed checks, downloads, authentication, or document checkpoints leave the editor open and show an error. Custom extension editors must implement their own persistence; automatic recovery covers text documents.

On Ubuntu/Debian, installation uses Polkit (`pkexec`) to request normal administrator authorization and verifies the installed package version before restarting. Install `pkexec` through your distribution if it is unavailable. macOS installation can request normal authorization if the app bundle is not writable. Move the app out of the disk image into Applications before updating.

No Apple Developer account is needed for the GitHub feed or Sparkle's cryptographic update signatures. The initial macOS download is not Developer ID signed/notarized; use the normal **Privacy & Security → Open Anyway** approval if macOS blocks the app. Windows installers are currently unsigned and may show an unknown-publisher/SmartScreen prompt. These operating-system trust prompts are separate from the app's update checks. Do not disable system security or Electron sandboxing.

## Building and publishing

1. Merge shared work and verified platform fixes into `development`. Run `npm run setup` with Node 24.21.0 on the target OS.
2. Set `package.json` and `package-lock.json` to the next stable semantic version. Update the release notes.
3. Run **Installers and updates** with publishing disabled. Its native runners build and install the actual packages, exercise editing and the terminal, then update a previous-version fixture to the release artifact and verify restart/recovery.
4. After verification, fast-forward `main` to the verified commit. Run **Publish verified installers** on `main`, supplying the successful run's numeric ID. It requires successful native checks for that exact commit, verifies all four checksum files, then creates `v<version>` and publishes the tested installers and update metadata together. Alternatively, pushing `v<version>` runs fresh native builds and publishes only after they pass. Published versions are immutable; publish a higher version for fixes.

`npm run package:release` builds the host installer into ignored `release/`. `npm run package:dir` builds an unpacked app for debugging. Packaging preserves the backend's Node ABI and does not rebuild its native modules for Electron.

GitHub Actions secret **SPARKLE_PRIVATE_KEY** contains the Ed25519 private key in PEM format. `assets/update-key.json` contains only its public key. Keep the private key backed up securely; losing it prevents existing macOS installs from accepting later updates signed by another key. Never commit it, log it, or change the public key without an update key rotation plan. The initial key backup on the maintainer's machine is `~/.config/singularity-release-keys/sparkle-private.pem` with owner-only access.

The Sparkle SDK version and SHA256 digest are pinned in `scripts/prepare-sparkle.cjs`. The official CLI is built with the app's bundle identifier and a machine-readable probe version. Its license is included in the packaged helper. Release artifacts have SHA256 checksum files. Test sources in `tests/` stay excluded from Git; native installer checks live inline in the workflow.
