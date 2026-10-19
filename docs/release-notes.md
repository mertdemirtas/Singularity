## Singularity 0.1.5

- Improved reliability after sleep, wake and connection interruptions. Existing editor sessions stay connected, and stale socket events cannot interrupt a replacement connection.
- Fixed stuck tab clicks and drag handles after a lost mouse release or window focus change.
- Fixed extensions blocking Save and closing indefinitely when their save hooks stop responding. Saves proceed after the hook deadline without accumulating more hung requests.
- Fixed a memory leak when repeatedly opening and closing editors by releasing their contexts, listeners and link handlers.
- Improved backend process cleanup after the desktop app exits or crashes.
- Fixed retrying session persistence after storage errors, and kept unsaved-file checks active when a close attempt fails.

Verified with backend and session regression tests, native app and installer/update checks on Linux, Windows and both macOS architectures, and a ten-minute stress test with 3,000 project files and a 12 MB CSV. The stress test is accelerated testing, not a full two-hour physical sleep/wake test.

**Linux users upgrading from 0.1.0–0.1.3:** install the latest `.deb` manually once to migrate to the `singularity-editor` package name. Users on 0.1.4 can update normally.

See [installation and updates](https://github.com/mertdemirtas/Singularity/blob/main/docs/releases.md) for downloads and instructions.
