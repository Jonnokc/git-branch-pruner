# Git Branch Pruner

Finds local branches whose remote branch has been deleted and lets you delete them from one checklist.

## Features

- A branch counts as stale only when git's own upstream tracking reports its remote branch as `[gone]`. Branches you never pushed are left alone.
- You review every deletion in one checklist: untick the branches you want to keep and press Enter.
- `main`, `master`, `develop`, your current branch and branches checked out in other worktrees are never offered for deletion.
- It works in a WSL window. The extension runs inside WSL next to your repository and fetches with the same credentials as VS Code's Source Control view.
- A background scan can run on a timer and notify you when it finds stale branches.
- You can scan every repository in the workspace or only the one you're working in.
- Identify-only mode lists stale branches without offering to delete them.

## Quick start

1. Install the extension.
2. Click "Prune" in the status bar.
3. Choose "Prune Stale Local Branches" or "Identify Stale Branches". If you're not sure, start with Identify to see what would be removed.

## Settings

Open Settings and search for "Git Branch Pruner".

### Scope

- `gitBranchPruner.pruneAllWorkspaceRepos` (default: `false`)
  - `true`: scan every git repository in the workspace
  - `false`: scan only the repository that contains the active file

### Auto-scan

- `gitBranchPruner.autoScanInterval` (default: `60`)
  - How often, in minutes, to scan for stale branches in the background
  - `0` turns auto-scan off. Any other value below 15 is treated as 15.
  - The first scan runs about 30 seconds after VS Code starts.

### Protected branches

- `gitBranchPruner.protectedBranches` (default: `["main", "master", "develop"]`)
  - Branch names that are never offered for deletion. Your current branch and branches checked out in other worktrees are always protected too.

### Notifications

- `gitBranchPruner.showNotifications` (default: `true`)
  - Show a notification when a scan finds nothing or when branches are deleted

### Identify-only mode

- `gitBranchPruner.identifyOnly` (default: `false`)
  - Lists stale branches but never deletes them. Auto-scan notifications offer "Show" and "Snooze" instead of "Prune Now".

## Usage

### Status bar

Click "Prune" in the status bar to choose between:

- Prune Stale Local Branches, which finds stale branches and lets you delete them
- Identify Stale Branches, which lists them without deleting anything

After a scan, the button shows the count, for example "Prune (3)".

### Command palette

Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) and search for:

- `Git Branch Pruner: Show Prune Menu`
- `Git Branch Pruner: Prune Stale Branches`
- `Git Branch Pruner: Prune Stale Branches (Active Repository Only)`
- `Git Branch Pruner: Show Pruneable Branches`

### Auto-scan notifications

When a background scan finds stale branches, the notification offers "Prune Now" and "Snooze". In identify-only mode it offers "Show" and "Snooze". Snooze pauses notifications for 1 hour, 4 hours or 24 hours.

### Reviewing and deleting

Every prune opens one checklist with all the stale branches ticked. Each row shows the branch's last commit date and message. Untick anything you want to keep and press Enter to delete the rest. "Prune Now" on a notification opens this checklist with the results of the scan that raised it, so nothing is scanned twice.

## How it works

Each scan runs `git fetch --all --prune`, then treats a branch as stale when all of these are true:

1. It has an upstream branch configured.
2. Git reports that upstream as `[gone]`, meaning the remote branch was deleted.
3. It isn't protected, isn't your current branch, and isn't checked out in another worktree.

Branches are deleted with `git branch -D`, because branches merged by squash or rebase look unmerged to git. Each deletion is logged in the "Git Branch Pruner" output panel.

If the fetch fails, for example because there's no network or no credentials, the scan still runs against the last successful fetch and shows a warning. A branch deleted on the remote since then won't appear until a fetch succeeds.

## Configuration examples

### Hourly auto-scan of all repositories

```json
{
  "gitBranchPruner.pruneAllWorkspaceRepos": true,
  "gitBranchPruner.autoScanInterval": 60,
  "gitBranchPruner.showNotifications": true,
  "gitBranchPruner.identifyOnly": false
}
```

### Monitor only

```json
{
  "gitBranchPruner.autoScanInterval": 30,
  "gitBranchPruner.identifyOnly": true,
  "gitBranchPruner.showNotifications": true
}
```

### Manual only (no auto-scan)

```json
{
  "gitBranchPruner.autoScanInterval": 0,
  "gitBranchPruner.pruneAllWorkspaceRepos": false
}
```

## Troubleshooting

### No stale branches found

1. Check that you have local branches whose remote branch was deleted.
2. Look in the "Git Branch Pruner" output panel for errors.
3. Run `git fetch --prune` yourself and try again.

### Using WSL

The extension has to run inside WSL, next to your repository. In a WSL window, open the Extensions view. If Git Branch Pruner Helper shows "Install in WSL: \<distro\>", click it. The Prune button appears only after it's installed there.

Fetching goes through VS Code's built-in Git extension, so it uses the same credentials as the Source Control view. A "Couldn't fetch" warning usually means the remote needs credentials that git in WSL doesn't have. Try Fetch from the Source Control view, or set up a `credential.helper` in WSL. The output panel has the full error.

### Auto-scan not working

1. Check that `autoScanInterval` is greater than 0.
2. Check that the workspace contains a git repository.
3. Look for errors in the output panel.

### Status bar button missing

1. The extension starts once VS Code has finished loading, so give it a moment.
2. Restart VS Code if the button still doesn't appear.
3. Check that the extension is enabled in the Extensions view. In a WSL window, see "Using WSL" above.

## Requirements

- Git installed and on your PATH (inside WSL when you use a WSL window)
- A workspace with at least one git repository
- Access to the remote, so fetches can tell which branches were deleted
