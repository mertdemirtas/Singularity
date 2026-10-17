# Performance checks

Measured locally on 17 October 2026 with the production build, Ubuntu 24.04,
an AMD Ryzen 7 PRO 4750U, and approximately 15 GiB of RAM. Desktop automation
used software rendering and isolated profiles. Electron sandboxing, default
autosave, and document recovery stayed enabled. Times depend on hardware,
extensions, and the session being restored.

## Startup

Measured from launching the desktop process until the workbench reports ready.
These figures use the bundled extensions and an empty session.

| Case | Time |
| --- | ---: |
| Earlier build, two fresh-profile runs | 4.09 s average |
| Updated build, fresh profile | 3.98 s |
| Updated build, reopening the same clean profile | 2.73 s |

The backend reuses its previous loopback port when available, allowing Chromium
to reuse compiled scripts. An occupied port falls back to a new port. Backend
readiness uses IPC instead of polling. Closed default panes are created when
opened, and the loading fade no longer delays the ready editor. Hashed asset
requests now use the compressed copies, reducing the main script transfer from
about 14.3 MiB to 3.7 MiB. Both development and production builds regenerate
compressed assets after applying the theme.

## Large project

The temporary Git project contained 30,000 source files across 200 folders and
70,000 ignored dependency files. No stress fixtures were added to the repository.

| Operation | Time |
| --- | ---: |
| Filename search, 200 matches | 158 ms |
| Text search across all 30,000 source files, 200 matches | 485 ms |
| Reveal a nested source file in Explorer | 29 ms |

Search correctly excluded the ignored dependencies.

## CSV editing

Each file was opened, scrolled to the beginning/middle/end, edited 60 times over
180 animation frames, checkpointed by recovery, saved, and closed. The test
verified recovery text and on-disk edits, then checked that saving removed the
recovery copy. Background throttling was disabled only in the stress-test
process so foreground editing measurements were consistent.

| CSV | Lines | Open | Edit, 95th percentile | Frame, 95th percentile | Save |
| --- | ---: | ---: | ---: | ---: | ---: |
| 33 MiB | 346,006 | 2.65 s | 3.2 ms | 14.3 ms | 2.22 s |
| 101 MiB | 1,058,986 | 4.48 s | 2.0 ms | 13.7 ms | 6.31 s |
| Wide rows, 12.9 MiB | 846 | 0.95 s | 3.2 ms | 16.2 ms | 0.13 s |

Profiling found repeated whole-file Git gutter diffs dominating large-file
editing. Large-file mode skips those diffs and automatic extension document
synchronization, and avoids wrapping every row. Large saves use 4 MiB chunks
instead of exceeding the transport's 100 MB message limit.

Opening and saving still load/process the full text and require substantial
memory; this is not a paged CSV viewer. Sizes beyond these fixtures and native
Windows/macOS performance were not measured. Separately, all 50 regression tests
passed, including recovery, write failures, backend readiness, port conflicts,
extension document lifecycle, sidebar behavior, and update handling.
