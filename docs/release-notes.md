## Singularity 0.1.6

- Connect to a device by typing `ssh user@host` in the integrated terminal. Browse its files in the separate **Remote** sidebar and save edits directly to the device. Local folders remain in **Files**.
- Remote connections support passwords, private keys, SSH agents and common OpenSSH aliases. Host keys are verified; passwords and passphrases are never saved. Reconnect from the terminal after restarting to restore remote file tabs.
- Remove installed extensions from their settings or by right-clicking their sidebar icons. Built-in extensions are protected, and **Reload Window** finishes unloading removed extensions.
- Fixed slow saves incorrectly marking newer edits as saved. Text typed during disk or network writes remains unsaved until the next save.
- Fixed invalid SSH port zero silently falling back to port 22.

Verified with 52 backend/session tests, desktop SSH and extension-removal checks, native installer and automatic-update checks on Linux, Windows and both macOS architectures, and a ten-minute session stress test. Advanced SSH options and jump hosts use system OpenSSH without automatic file browsing; extensions continue to run locally.

**Linux users upgrading from 0.1.0–0.1.3:** install the latest `.deb` manually once to migrate to the `singularity-editor` package name. Users on 0.1.4 or later can update normally.

See [installation and updates](https://github.com/mertdemirtas/Singularity/blob/main/docs/releases.md) for downloads and instructions.
