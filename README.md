# Singularity

<img src="assets/singularity-icon.png" width="96" alt="Singularity icon">

A simple desktop text editor for notes and code, available on Linux, Windows, and macOS.

## Download

[Download the latest release](https://github.com/mertdemirtas/Singularity/releases/latest) and follow the [installation guide](docs/releases.md).

## What you can do

- Edit text, Markdown, and code in tabs or split views.
- Choose your theme and font, or hide distractions with focus mode.
- Use the terminal, Git tools, and built-in browser for development.
- Add extensions from Open VSX. Some VS Code extensions may not be compatible.
- Restore your previous tabs and recover unsaved text after a crash.

## Getting started

1. Open a file or folder from the Welcome page or the **Files** pane.
2. Use **+** beside the tabs to create a file.
3. Open **Menu → Settings** to change the theme, font, and editing preferences.
4. Open **Extensions** in the sidebar to find additional tools.

Auto-save is enabled when you switch away from the app. Use **Save As** to name a new file or keep a **Recovered** document.

Drag sidebar icons to reorder them. Right-click an icon to hide it, or right-click empty sidebar space to restore icons and reset the layout.

To choose a GitHub repository, use **Files → Open → Clone Repository** and select GitHub. The GitHub Pull Requests extension shows pull requests and issues for the repository folder you have open. Its optional Copilot chat attachments are unavailable in Singularity.

Large text files use a lighter editing mode: automatic Git gutter diffs and extension document processing are disabled when Monaco marks a file as large (normally above 20 MB or 300,000 lines). Editing, saving, and crash recovery remain available. Very wide files open without word wrap.

## Keyboard shortcuts

Use **Cmd** instead of **Ctrl** on macOS.

| Action | Shortcut |
| --- | --- |
| New file | Ctrl+N |
| Open file | Ctrl+O |
| Save | Ctrl+S |
| Close tab | Ctrl+W |
| Settings | Ctrl+, |

## Updates

Singularity checks for updates automatically. You can also use **Menu → Check for updates**. Choose **Update and restart** when a new version is available.

For source builds and contributions, see the [development guide](docs/branches.md).
