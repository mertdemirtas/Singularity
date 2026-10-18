## Singularity 0.1.4

- Fixed Ubuntu system upgrades replacing the editor with an unrelated game named `singularity`. The editor now uses the distinct Linux package, executable, launcher, and icon identifier `singularity-editor`; its displayed name remains **Singularity**.
- Older editor packages migrate to the new name while preserving settings and files. The unrelated Ubuntu game can remain installed alongside the editor.
- Linux update verification now checks the correct editor package. Installer checks also verify coexistence with the Ubuntu game and discovery of the editor's launcher and icons.

**Linux users upgrading from 0.1.0–0.1.3:** download and install the 0.1.4 `.deb` once, even if the older in-app updater reports an error. Subsequent updates use the new package name. Windows and macOS users can update normally.

See [installation and updates](https://github.com/mertdemirtas/Singularity/blob/main/docs/releases.md) for downloads and instructions.
