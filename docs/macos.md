# macOS source build

Use the `macos` branch with a supported macOS installation on Apple Silicon
or Intel. Native CI builds run on macOS 15 for both architectures.

Install Git, Node.js 24 LTS for your architecture, Python 3, and Xcode Command
Line Tools (`xcode-select --install`). Then run in Terminal:

```sh
git clone --branch macos https://github.com/mertdemirtas/Singularity.git
cd Singularity
npm run setup
npm run desktop
```

Do not copy dependencies from Linux, Windows, or another Mac architecture.
Setup builds the native Node modules and downloads the matching Electron binary.
The source launcher keeps the same Node executable for the Theia backend, avoiding
Electron/Node module-ABI mismatches. The terminal falls back to `/bin/zsh` if a GUI
launch has no `SHELL` environment variable.

The app uses AppKit font discovery, a native application/edit menu, Command-based
editor shortcuts, the Singularity Dock icon, and native rounded window corners.
Control remains available to terminals and text editing. Navigation uses
Control+Minus and Control+Shift+Minus rather than intercepting Option+Left/Right
word movement. Python 3 is located on PATH; the existing run shortcut is
Command+Option+R.

`npm run install:desktop` is the Ubuntu launcher installer and is not needed on
macOS. These are source-build instructions, not a signed/notarized `.dmg` release.
See [branch and native-check policy](branches.md).
