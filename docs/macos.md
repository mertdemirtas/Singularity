# Build from source on macOS

To install the app normally, follow the [installation guide](releases.md).

## Requirements

- macOS 13.5 or later, on Apple Silicon or Intel ([Node.js requirements](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)).
- Git.
- Node.js 24.21.0 with npm, matching your Mac's architecture.
- Python 3, available in your terminal.
- Xcode Command Line Tools. Install them with:

  ```sh
  xcode-select --install
  ```

## Build and launch

Run these commands in Terminal:

```sh
git clone --branch development https://github.com/mertdemirtas/Singularity.git
cd Singularity
npm run setup
npm run desktop
```

Setup installs dependencies and builds the app. Run `npm run desktop` whenever you want to launch it again.

Install dependencies on this Mac; do not copy `node_modules` from another operating system or architecture.

See the [development guide](branches.md) for build commands and release instructions.
