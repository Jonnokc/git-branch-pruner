# Change Log

All notable changes to the "git-branch-pruner" extension will be documented in this file.

## [1.1.0]

- Works in a WSL window. The extension runs where the repository is and fetches through VS Code's Git extension, so credentials work.
- A failed fetch no longer hides every stale branch. The scan carries on with the last fetched data and shows a warning.
- One confirmation instead of two: a checklist of stale branches replaces the modal, and "Prune Now" reuses the auto-scan results.
- Detection uses git's `[gone]` upstream tracking, so branches that were never pushed are never flagged.
- New `protectedBranches` setting (default `main`, `master`, `develop`). Branches checked out in other worktrees are skipped.
- The status bar shows how many stale branches the last scan found.
- Commands no longer rewrite your `pruneAllWorkspaceRepos` or `identifyOnly` settings.
- `autoScanInterval` accepts 0 again to turn auto-scan off, and the first scan runs about 30 seconds after startup.
- Scans can't overlap, and fetches time out instead of hanging.
- Removed the `simple-git` dependency.

## [1.0.0]

- Initial release
