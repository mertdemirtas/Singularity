# Build from source on Windows

To install the app normally, follow the [installation guide](releases.md).

## Requirements

- Windows 10 or later, x64.
- Git for Windows.
- Node.js 24.21.0 with npm.
- Python 3, available in your terminal.
- Visual Studio 2022 Build Tools with **Desktop development with C++** and a Windows SDK.

## Build and launch

Run these commands in PowerShell or Command Prompt:

```text
git clone --branch development https://github.com/mertdemirtas/Singularity.git
cd Singularity
npm run setup
npm run desktop
```

Setup installs dependencies and builds the app. Run `npm run desktop` whenever you want to launch it again.

Install dependencies on this computer; do not copy `node_modules` from another operating system.

See the [development guide](branches.md) for build commands and release instructions.
