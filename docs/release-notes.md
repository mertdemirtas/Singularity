## Singularity 0.1.0

First installable release of Singularity: a simple desktop text editor with optional development tools.

- Linux x64: download the `.deb` and open it with your package installer, or run `sudo apt install ./Singularity-0.1.0-linux-amd64.deb`.
- Windows x64: run the `.exe` installer. It installs for the current user.
- macOS: download the `.dmg` for your Mac (`arm64` for Apple Silicon, `x64` for Intel) and drag Singularity to Applications. The `.zip` files are also used by the updater.

Node.js and npm are bundled. Git, Python, and other project tools are installed separately when needed.

The app checks published GitHub releases at startup and periodically. Open **Menu → Check for updates** for a manual check. Choose **Update and restart** to download, install, and restart. Open text documents are preserved, including unsaved work when regular crash recovery is disabled. Linux may request your administrator password to install the package.

macOS updates use Sparkle and an Ed25519 signature verified against the public key in the installed app. This release has no Apple Developer ID/notarization or Windows Authenticode certificate. First installation may require approval through the operating system's security UI. See [installation and updates](https://github.com/mertdemirtas/Singularity/blob/main/docs/releases.md).
