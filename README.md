# Git Branch Pruner

Keep your local git repositories clean by automatically identifying and removing branches that no longer exist on the remote server.

## Features

✨ **Smart Detection** - Accurately identifies stale local branches using git tracking information
🛡️ **Safe by Default** - Protects main, master, and your current branch from deletion
🔄 **Auto-Scan** - Configurable background scanning with smart notifications
⚙️ **Flexible Scope** - Work with all workspace repositories or just the active one
👁️ **Identify Mode** - Preview stale branches without deletion options

## Quick Start

1. Install the extension
2. Click the **🌿 Prune** button in the status bar
3. Choose "Prune Stale Local Branches" or "Identify Stale Branches"

## Settings

Access settings via `Code → Preferences → Settings` and search for "Git Branch Pruner":

### **Scope Control**

- **`gitBranchPruner.pruneAllWorkspaceRepos`** (default: `false`)
  - `true`: Scan all git repositories in your workspace
  - `false`: Only scan the repository containing your active file

### **Auto-Scan**

- **`gitBranchPruner.autoScanInterval`** (default: `60` minutes)
  - How often to automatically scan for stale branches
  - Set to `0` to disable auto-scanning
  - Minimum: 1 minute

### **Notifications**

- **`gitBranchPruner.showNotifications`** (default: `true`)
  - Show notifications when branches are found or deleted

### **Identify Only Mode**

- **`gitBranchPruner.identifyOnly`** (default: `false`)
  - When enabled, auto-scan notifications only show "Snooze" option
  - Perfect for monitoring without accidental deletions

## Usage

### Status Bar

Click the **🌿 Prune** button in your status bar to access:

- **Prune Stale Local Branches** - Find and delete stale branches
- **Identify Stale Branches** - Preview stale branches without deletion

### Command Palette

Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) and search for:

- `Git Branch Pruner: Show Prune Menu`
- `Git Branch Pruner: Prune Stale Branches`
- `Git Branch Pruner: Prune Stale Branches (Active Repository Only)`
- `Git Branch Pruner: Show Pruneable Branches`

### Auto-Scan Notifications

When stale branches are found, you'll see a notification with options:

- **Normal Mode**: "Prune Now" and "Snooze" buttons
- **Identify Only Mode**: Only "Snooze" button (no deletion option)

Snooze options: 1 hour, 4 hours, or 24 hours

## How It Works

### Stale Branch Detection

A branch is considered stale when:

1. It has remote tracking configuration (`branch.BRANCH.remote` and `branch.BRANCH.merge`)
2. The remote branch it was tracking no longer exists
3. It's not a protected branch (main, master, or current branch)

### Safety Features

- **Protected Branches**: Never deletes `main`, `master`, or your current branch
- **Confirmation Required**: Always asks before deleting branches (except in Identify Only mode)
- **Detailed Logging**: Check the "Git Branch Pruner" output panel for operation details

## Configuration Examples

### Hourly Auto-Scan (All Repositories)

```json
{
  "gitBranchPruner.pruneAllWorkspaceRepos": true,
  "gitBranchPruner.autoScanInterval": 60,
  "gitBranchPruner.showNotifications": true,
  "gitBranchPruner.identifyOnly": false
}
```

### Monitor Mode (Identify Only)

```json
{
  "gitBranchPruner.autoScanInterval": 30,
  "gitBranchPruner.identifyOnly": true,
  "gitBranchPruner.showNotifications": true
}
```

### Manual Only (No Auto-Scan)

```json
{
  "gitBranchPruner.autoScanInterval": 0,
  "gitBranchPruner.pruneAllWorkspaceRepos": false
}
```

## Troubleshooting

### Extension Not Finding Stale Branches

1. Ensure you have stale local branches (branches that tracked remotes that were deleted)
2. Check the "Git Branch Pruner" output panel for detailed information
3. Try running `git fetch --prune` manually first

### Auto-Scan Not Working

1. Verify `autoScanInterval` is greater than 0
2. Check that you're in a workspace with git repositories
3. Look for error messages in the output panel

### Status Bar Button Missing

1. The extension activates when VSCode starts
2. Restart VSCode if the button doesn't appear
3. Check that the extension is enabled in the Extensions panel

## Requirements

- Git must be installed and accessible in your system PATH
- VSCode workspace must contain git repositories
- Remote repositories should be accessible for accurate stale branch detection

---

**Tip**: Start with "Identify Stale Branches" to see what would be cleaned up before using the deletion features!
