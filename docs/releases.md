# Installation and updates

## Choose your download

Open [GitHub Releases](https://github.com/mertdemirtas/Singularity/releases/latest) and download the installer for your computer.

| System | Look for |
| --- | --- |
| Ubuntu / Debian, x64 | `.deb` |
| Windows 10 or later, x64 | `.exe` |
| macOS 13.5 or later, Apple Silicon | `mac-arm64.dmg` |
| macOS 13.5 or later, Intel | `mac-x64.dmg` |

You only need the installer. The `.zip`, `.blockmap`, and update metadata files are used for updates.

## Ubuntu / Debian

1. Download the `.deb` file.
2. Open a terminal in the folder containing the download and run:

   ```sh
   sudo apt install ./Singularity-0.1.5-linux-amd64.deb
   ```

3. Open **Singularity** from your applications menu.

The editor's Linux package is named `singularity-editor`. Ubuntu's `singularity` package is an unrelated game; do not use `apt install singularity` to install the editor. If a system upgrade replaced an older editor with that game, reinstall using the downloaded `.deb`. Your editor settings and files are kept.

**Upgrading from Linux versions 0.1.0–0.1.3:** install the latest `.deb` manually once to migrate the package name. An older in-app updater may report an error during this migration. Later updates use the new package name.

## Windows

1. Download and open the `.exe` installer.
2. Approve installation if Windows prompts you. This release is not publisher-signed.
3. Open **Singularity** from the Start menu.

## macOS

1. Download and open the `.dmg` for your Mac.
2. Drag **Singularity** into **Applications**.
3. Open it from **Applications**.

If macOS blocks the app, use **System Settings → Privacy & Security → Open Anyway**. This release is not Apple Developer ID signed or notarized.

## Optional tools

Node.js and npm are included. Install Python, Git, or other project tools separately if you need them. AI command-line tools also need their own installation and sign-in.

## Updates

The app checks GitHub for new releases automatically. To check yourself, open **Menu → Check for updates**.

Choose **Update and restart** to download and install a new version. Installation may ask for your administrator password. Your settings and open tabs are kept; unsaved text reopens in **Recovered** tabs. Use **Save As** to keep recovered documents.

## Building from source

Developers can use the [development guide](branches.md) instead of an installer.
