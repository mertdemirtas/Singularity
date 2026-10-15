# Windows source build

Use the `development` branch on Windows 10/11 x64. Install Git for Windows, Node.js
24 LTS, Python 3, and Visual Studio 2022 Build Tools with Desktop development
with C++ and a Windows SDK. Python and Node must be available in the terminal.

From PowerShell or Command Prompt:

```text
git clone --branch development https://github.com/mertdemirtas/Singularity.git
cd Singularity
npm run setup
npm run desktop
```

Setup uses Node rather than Bash. It builds native dependencies on Windows,
downloads Electron for the current architecture, downloads the bundled language
extensions, and builds the frontend/backend. No Linux SUID helper is used.

The existing Python runner checks `py -3`, then Python 3 on PATH. Its reusable
terminal uses Windows PowerShell with correctly quoted filenames. Other terminals
retain Theia's normal Windows shell. SSH requires Windows OpenSSH Client to be
installed. The window uses an opaque native surface for reliable resizing; Windows
11 supplies rounded corners, while Windows 10 may use square corners.

`npm run install:desktop` remains the Ubuntu launcher installer. On Windows,
start the source checkout with `npm run desktop`; this branch does not provide
a signed `.exe` installer. See [branch and native-check policy](branches.md).
