## Singularity 0.1.7

- Saved SSH devices appear in **Remote → Connections**. Reconnect with one click and enter any required password or passphrase in the terminal. Repeated clicks reuse the same connection terminal; restarting never signs in automatically.
- Window controls now share the tab toolbar layout. Thin, themed dividers separate editor actions, extension actions and window controls. In narrow panes, secondary actions move into **More Actions** without clipping buttons.
- Larger sidebar buttons and icons fit inside the original compact sidebar width.
- The terminal panel has **Minimize**, which keeps sessions running, and **Close All**, which asks for confirmation before stopping terminals.
- **Export PDF** appears only for `.md`, `.markdown`, `.txt`, `.text` and Markdown previews. Its menu opens below the title bar.
- Fixed startup collapsing previously open panels. Restored panels keep their sidebar selection; fresh sessions start with tools closed.

Verified with 64 backend/session tests, native desktop, SSH reconnect, extension-removal and recovery checks on Linux, Windows and both macOS architectures, installer and automatic-update checks, and a ten-minute session stress test.

**Linux users upgrading from 0.1.0–0.1.3:** install the latest `.deb` manually once to migrate to the `singularity-editor` package name. Users on 0.1.4 or later can update normally.

See [installation and updates](https://github.com/mertdemirtas/Singularity/blob/main/docs/releases.md) for downloads and instructions.
