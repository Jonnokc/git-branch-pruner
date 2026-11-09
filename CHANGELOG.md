# Change Log

All notable changes to the "git-branch-pruner" extension will be documented in this file.

## [1.2.0]

- Each repository is scanned once, however many of its worktrees are open. VS Code opens every worktree as its own repository, so a repository with 11 worktrees used to be fetched 11 times and list each stale branch 11 times. Results now carry the main repository's name, not a worktree folder's.
- Worktrees whose folders were deleted are skipped instead of showing up as scan errors.
- Stale branches still checked out in a deleted worktree are reported. Git won't delete them until its record of that worktree is removed. "Clean Up Worktrees" runs `git worktree prune`, which removes only the records of folders that are already gone, then opens the checklist with those branches included.

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
