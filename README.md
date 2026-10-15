# Singularity

<img src="assets/singularity-icon.png" width="96" alt="Singularity icon">

Singularity is a small Ubuntu-inspired desktop editor for notes and code. It restores the tabs and split views from the previous session. With no tabs to restore, a Welcome page offers Open File, Open Folder, New File, recent files, and Settings.

It uses [Eclipse Theia](https://theia-ide.org/) for local files, Monaco editing, the terminal, and VS Code compatible extensions. The extension catalog comes from Open VSX. Compatibility depends on the APIs an extension uses.

## Source installation

Platform setup: [Windows](docs/windows.md) · [macOS](docs/macos.md).

The verified Windows and macOS compatibility changes are integrated into `development`. See [branch and native-check policy](docs/branches.md).

### Linux

Use Node.js 24 LTS and npm. On Ubuntu, install the native build dependencies:

```sh
sudo apt-get install -y python3 build-essential libsecret-1-dev libx11-dev libxkbfile-dev libkrb5-dev
```

Then run:

```sh
npm run setup
npm run desktop
```

The project folder is `Singularity`. Run `npm run install:desktop` to add the Singularity launcher and supplied app icon to Ubuntu's application menu. Run the installer again if you move the project folder. Existing settings, extensions, and saved tabs remain compatible with the previous app name.

On Ubuntu, Electron's Chromium sandbox helper must be owned by root and have mode `4755`. Before launch, the app checks `node_modules/electron/dist/chrome-sandbox`. If npm has replaced it, the app can link to the existing root-managed Google Chrome helper. If that helper is unavailable, run `sudo chown root:root node_modules/electron/dist/chrome-sandbox` and `sudo chmod 4755 node_modules/electron/dist/chrome-sandbox` before starting the app. Sandboxing stays enabled.

The setup script downloads dependencies and the official Python, Markdown, JavaScript, TypeScript, JSON, HTML, CSS, and C/C++ syntax packs. It builds in a temporary folder when the project path has spaces, which works around a native dependency build bug.
It finishes with the optimized release build. Use `npm run build` when developing the editor UI, or `npm run build:release` to update the optimized desktop build.

The document tabs and window controls share one title row. Use the **+** beside the tabs to create a file, and the two split buttons to split the editor right or down. The eye at the right end of the tab tools enters focus mode, keeping document tabs and **+** visible while hiding the sidebar and Back/Forward controls.

Theme and font family use matching dropdowns in Settings. The font list includes installed monospace fonts and preserves any custom font stack from your JSON settings. Scrolling leaves up to ten extra lines below the document, adapting to its line height.

Use `development` for shared application work, `windows` for Windows compatibility work, and `macos` for macOS compatibility work. Keep `main` for stable releases. Local test files in `tests/`, generated builds, dependencies, and downloaded language extensions are excluded from version control.

Drag the empty part of the tab row or the title-row space above an open side pane to move the app. Electron 43 handles native edge and corner resizing, including the top-left corner when Files or an extension pane is open. Clicking inside a temporary hover pane pins it before opening its file or action. Files clicks activate the selected registered opener, and delayed focus reports from hidden extension webviews are ignored.

Files sits at the top of a compact icon rail fixed on the left, with **Source Control** directly below it. Its colors follow the selected theme. Thin separators use the theme's panel border color, with black as the fallback. The bottom buttons are **Extensions**, **Extension views** (layers icon), **Terminal**, and **Menu** (hamburger), in that order. Open Settings through Menu or **Ctrl+,**. Hover over Files or Extensions for a temporary pane, or click the icon to keep it open. Drag the divider to resize a pinned pane, use its **×** to close it, or use the top-left sidebar toggle to hide and restore the sidebar and pane together. Hover over **Extension views** to choose an installed extension's sidebar view. The menu adapts to its entries and includes registered sidebar contributions even before their panes have been opened.

The top-left sidebar toggle hides or shows the entire icon rail and its open pane. This choice persists between launches and is also available under **Settings → Appearance → Show sidebar** (`plainEditor.sidebarVisible`). The neighboring **Back** and **Forward** arrows revisit open document, browser, and development tabs; **Alt+Left** and **Alt+Right** do the same. Side panels and terminals do not add history entries. Closed tabs are removed from history, and each arrow's tooltip names its destination. Editor themes and fonts still apply inside the document area.

Extensions can provide their own run controls. For Python files, **Ctrl+Alt+R** also saves and runs with `python3` in a reusable terminal. Python 3 must be installed on your computer. The runner locates `py -3`/`python` on Windows and `python3`/`python` on Unix, and uses the appropriate terminal quoting.

The **Open** control inside the Files pane offers **Open File**, **Open Folder**, and recently opened files. The **…** menu has **Reopen Closed Tab** and **Save All**. Use **Ctrl+Shift+T** to reopen the last closed tab; **Clear Recent Files** removes the saved list.

Settings lets you choose a theme, font family, editor font size, auto-save behavior, line wrapping, and the code minimap. The selected font family applies to editor text, tabs, Files, menus, and the app's dialogs and tools. Comma-separated fallback families are preserved. Font choices use the OS font catalog: fontconfig on Linux, Windows installed fonts, and AppKit on macOS. The minimap also has an **×** button to hide it. Auto save defaults to **When app window loses focus**. The file path row beneath tabs is called **breadcrumbs**; it is hidden by default and can be enabled in **All settings** by searching for `breadcrumbs.enabled`. Use **Open user settings.json** in Settings to edit the same user preferences directly.

Shortcuts: **Ctrl+S** save, **Ctrl+Shift+S** Save As, **Ctrl+N** new file, **Ctrl+O** open file, **Ctrl+W** close tab, **Ctrl+Shift+T** reopen closed tab, **Ctrl+B** Files, **Ctrl+J** or **Ctrl+`** Terminal, **Ctrl+Shift+X** Extensions, **Ctrl+,** Settings, and **Ctrl+Q** quit. On macOS use Command for these actions; navigation uses Control+Minus and Control+Shift+Minus, preserving Option+Left/Right word movement.

Use the Extensions icon to search Open VSX for a LeetCode extension or other VS Code compatible extensions. To install a local `.vsix`, open the command palette with **F1** and run **Extensions: Install from VSIX...**. Some VS Code extensions may depend on APIs Theia does not implement or on their own sign-in flow.

Extension webviews use separate `*.webview.localhost` origins. This allows PDF viewers and other custom editors to load their resources and service workers in the desktop app. Recent files and Welcome actions use the registered file opener, so PDFs open through their installed viewer instead of being forced into the text editor. Right-click an entry in **Extension views** and select **Extension settings** to configure its owning extension.

## Development tools

Use the **Source Control** icon below Files, open **Menu → Source Control**, or press **Ctrl+Shift+G** for Git. Git and Git Base are bundled; install Git on your computer and open a trusted repository folder to review diffs, stage changes, commit, manage branches, and use its remote commands. The app does not automatically commit or push.

Open **Menu → Browser** for an integrated Chromium browser tab. It accepts HTTP/HTTPS websites, localhost addresses, and server addresses. Use Back, Forward, Reload, or the **</>** developer-tools button. **Ctrl+L** focuses the address and **Ctrl+W** closes the browser tab. Browser tabs restore their last URL with the session. Pages run in a separate browser profile with sandboxing, context isolation, and no editor APIs or Node.js access.

**Menu → Development tools** provides a server command and preview address. Start a command such as `npm run dev`, `npm start`, or `python3 -m http.server 8000` in the open project folder, then open its localhost URL in the browser. Repeated Start clicks reveal the existing terminal. Use Ctrl+C to stop a server; rerun its command in the terminal to restart it.

The same page includes built-in launchers for installed **Codex** and **Claude Code** CLIs in project terminals. Install and sign in to the CLI you want to use separately. Each CLI uses its own project instructions and configuration. Customize the commands with `plainEditor.ai.codexCommand` and `plainEditor.ai.claudeCommand` in All settings or settings.json. Compatible extensions are optional for richer editor integration. The editor does not install these CLIs or include a subscription.

For a remote server, enter its SSH host and port and optionally a local/remote port pair. **Connect in terminal** uses your existing SSH configuration and authentication. Open forwarded services at `http://localhost:<local-port>` in the browser. This provides SSH shell access and web previews; remote file editing depends on a compatible extension.

The app supports the VS Code extension APIs implemented by Theia and keeps extension version checks enabled. Universal compatibility with every Marketplace extension cannot be guaranteed; see [Theia’s extension compatibility guidance](https://theia-ide.org/docs/user_install_vscode_extensions/). Extensions relying on VS Code-specific private services may need changes from their authors.

In Extensions, filter by **Recommended**, **Installed**, **Enabled**, **Disabled**, or **Built-in**, and sort by download count, rating, or name. The verified icon limits results to verified extensions. Recommendations load from Open VSX when the pane opens, check compatibility, and exclude extensions already installed. A failed request shows a Retry button. The gear on an installed extension opens its declared settings, including switches, choices, numbers, text, and JSON values. Changes save to user settings; Reset restores the default. The **…** beside the gear keeps extension management actions available.

Run `npm run check` for dependency checks. Local checks under `tests/` remain excluded from Git; the compatibility workflow performs its native desktop checks directly on each OS.

For browser-only development, run `npm start` after setup and open `http://127.0.0.1:3000`.
