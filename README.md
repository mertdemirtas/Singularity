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

Use **Export PDF** in the tab toolbar to export Markdown, text, or code. In Markdown previews it sits beside **Show Source** and exports the rendered document. PDFs use white pages regardless of the app theme. Right-click the button and choose **Export Dark PDF** for a fixed dark palette, saved as `filename-dark.pdf`. Exports include unsaved edits and go to the project folder; without a project, choose a folder when prompted. Existing PDFs require confirmation before replacement. Text and code exports support files up to 20 MB.

On startup, Singularity restores your open tabs before showing the workspace. Closed tools stay closed; an empty session shows Welcome. Your last theme and font are used for the loading screen, and the selected font also applies to the terminal and extension UI.

Drag sidebar icons to reorder them. Right-click an icon to hide it, or right-click empty sidebar space to restore icons and reset the layout.

To choose a GitHub repository, use **Files → Open → Clone Repository** and select GitHub. The GitHub Pull Requests extension shows pull requests and issues for the repository folder you have open. Its optional Copilot chat attachments are unavailable in Singularity.

Source Control asks for your Git author name and email before your first commit if they are missing. These are saved only for that repository. Use **Configure Commit Identity** in Source Control or the command palette to change them later.

Click **Source Control** to open the Git workspace. Review changes, stage and commit, push and pull, manage branches, and view history and remotes. **History** shows each commit’s changed files and numbered diffs. **More…** contains tags, stashes, and other actions inside the workspace.

Git also works entirely on your computer. Open a folder, choose **Source Control → Initialize local repository**, stage your files, enter a commit message, and commit. No GitHub account, internet connection, or remote is required. **Local only** means commits stay on your computer. Connecting a remote or creating a GitHub repository is optional, under **Remotes**.

To merge, open **Branches**, choose **Merge…**, and confirm the source and destination. If conflicts occur, choose **Resolve** to compare the full files with highlighted differences. Use the buttons above each conflict to choose **Current**, **Incoming**, or **Both**. Click a source gutter icon to select changed lines, or edit **Result** yourself. **Use this file** replaces the entire result with that version. Use the conflict list to revisit resolved choices. You can change versions, use Undo/Redo, or Reset choices before saving. The selection button turns green when selected lines can be applied to that conflict. Resize the panes or use **View** for layout options. Use **Full screen** to focus on a conflict or code preview, and **Escape** to return. Then **Save and stage** and **Finish merge**. Conflict editing supports UTF-8 text files up to 1 MB.

Push, merge, abort, discard, and other destructive Git actions ask for confirmation before proceeding. Staged and unstaged files have separate scrolling lists; conflicts appear first in a distinct color.

Large text files use a lighter editing mode: automatic Git gutter diffs and extension document processing are disabled when Monaco marks a file as large (normally above 20 MB or 300,000 lines). Editing, saving, and crash recovery remain available. Very wide files open without word wrap.

The browser searches with Google and also opens websites, localhost, and server addresses. Its start page lists recent visits and closed pages saved on this computer. Use **Home** to return to it or **Clear history** to remove the list.

## Keyboard shortcuts

Use **Cmd** instead of **Ctrl** on macOS.

| Action | Shortcut |
| --- | --- |
| New file | Ctrl+N |
| Open file | Ctrl+O |
| Save | Ctrl+S |
| Close tab | Ctrl+W |
| Settings | Ctrl+, |

## SSH remote files

Open the integrated terminal and connect normally:

```sh
ssh user@host
# Optional port or private key:
ssh -p 2222 -i ~/.ssh/id_ed25519 user@host
```

Confirm the device’s host-key fingerprint and enter any password or key passphrase in the terminal. Its home folder appears automatically in the separate **Remote** sidebar section. **Files** keeps your local folders. Open and edit remote files normally; **Ctrl+S** saves to the connected device. The server must support SSH and SFTP. Passwords and passphrases are not saved.

After restarting, remote folders are marked offline. Reconnect in the terminal to reopen their file tabs. Ending the shell leaves file access connected; use **Singularity: Disconnect SSH** in the command palette to disconnect, or **Forget SSH Connection** to remove its saved details and host key.

Direct connections support passwords, private keys, SSH agents, and common OpenSSH host aliases. Advanced SSH options, jump hosts and remote command invocations use your system’s OpenSSH client without automatic file browsing. Extensions still execute locally; run remote programs in the SSH terminal.

## Updates

Singularity checks for updates automatically. You can also use **Menu → Check for updates**. Choose **Update and restart** when a new version is available.

For source builds and contributions, see the [development guide](docs/branches.md).
