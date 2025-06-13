import * as vscode from 'vscode';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs';

/**
 * Interface representing a stale branch that can be pruned
 */
interface StaleBranch {
    name: string;
    repositoryPath: string;
    repositoryName: string;
}

/**
 * Main extension class that handles git branch pruning functionality
 */
export class GitBranchPruner {
    private statusBarItem: vscode.StatusBarItem;
    private autoScanTimer: NodeJS.Timeout | undefined;
    private outputChannel: vscode.OutputChannel;
    private lastNotificationTime: number = 0;
    private notificationSnoozeUntil: number = 0;
    
    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Git Branch Pruner');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.setupStatusBar();
        this.setupAutoScan();
        this.setupConfigurationWatcher();
    }

    /**
     * Set up the status bar item with click handler
     */
    private setupStatusBar(): void {
        this.statusBarItem.text = "$(git-branch) Prune";
        this.statusBarItem.tooltip = "Click to manage stale git branches";
        this.statusBarItem.command = 'gitBranchPruner.showMenu';
        this.statusBarItem.show();
    }

    /**
     * Set up automatic scanning based on configuration
     */
    private setupAutoScan(): void {
        const config = vscode.workspace.getConfiguration('gitBranchPruner');
        const intervalMinutes = config.get<number>('autoScanInterval', 0);
        
        this.outputChannel.appendLine(`Setting up auto-scan: interval = ${intervalMinutes} minutes`);
        
        if (this.autoScanTimer) {
            clearInterval(this.autoScanTimer);
            this.outputChannel.appendLine(`Cleared existing auto-scan timer`);
        }
        
        if (intervalMinutes > 0) {
            const intervalMs = intervalMinutes * 60 * 1000;
            this.autoScanTimer = setInterval(() => {
                this.outputChannel.appendLine(`Auto-scan timer triggered`);
                this.runAutomaticScan();
            }, intervalMs);
            
            this.outputChannel.appendLine(`Auto-scan scheduled every ${intervalMinutes} minutes (${intervalMs}ms)`);
        } else {
            this.outputChannel.appendLine(`Auto-scan disabled (interval = 0)`);
        }
    }

    /**
     * Watch for configuration changes and update behavior accordingly
     */
    private setupConfigurationWatcher(): void {
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('gitBranchPruner.autoScanInterval')) {
                this.setupAutoScan();
            }
        });
    }

    /**
     * Run automatic scanning and notify if stale branches found
     */
    public async runAutomaticScan(): Promise<void> {
        this.outputChannel.appendLine(`=== Starting automatic scan ===`);
        
        // Check if we're in snooze period
        const now = Date.now();
        if (now < this.notificationSnoozeUntil) {
            const snoozeRemaining = Math.round((this.notificationSnoozeUntil - now) / (60 * 1000));
            this.outputChannel.appendLine(`Auto-scan skipped: snoozed for ${snoozeRemaining} more minutes`);
            return;
        }
        
        try {
            this.outputChannel.appendLine('Running automatic scan for stale branches...');
            
            // Get all workspace repositories
            const repositories = await this.getWorkspaceGitRepositories();
            if (repositories.length === 0) {
                return;
            }

            const reposWithStaleBranches: {[repoName: string]: StaleBranch[]} = {};
            let totalStaleBranches = 0;

            // Scan silently
            for (const repo of repositories) {
                const staleBranches = await this.getStaleBranches(repo);
                if (staleBranches.length > 0) {
                    const repoName = path.basename(repo);
                    reposWithStaleBranches[repoName] = staleBranches;
                    totalStaleBranches += staleBranches.length;
                }
            }

            if (totalStaleBranches > 0) {
                await this.showStaleFoundNotification(reposWithStaleBranches, totalStaleBranches);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Auto-scan failed: ${error}`);
        }
    }

    /**
     * Get all git repositories in the current workspace
     */
    private async getWorkspaceGitRepositories(): Promise<string[]> {
        const repositories: string[] = [];
        
        if (!vscode.workspace.workspaceFolders) {
            return repositories;
        }
        
        for (const folder of vscode.workspace.workspaceFolders) {
            const repoPath = await this.findGitRepository(folder.uri.fsPath);
            if (repoPath) {
                repositories.push(repoPath);
            }
        }
        
        return repositories;
    }

    /**
     * Find git repository starting from a given path
     */
    private async findGitRepository(startPath: string): Promise<string | null> {
        let currentPath = startPath;
        
        while (currentPath !== path.dirname(currentPath)) {
            const gitPath = path.join(currentPath, '.git');
            if (fs.existsSync(gitPath)) {
                return currentPath;
            }
            currentPath = path.dirname(currentPath);
        }
        
        return null;
    }

    /**
     * Get the git repository for the currently active file
     */
    private async getActiveRepository(): Promise<string | null> {
        const activeEditor = vscode.window.activeTextEditor;
        this.outputChannel.appendLine(`Active editor: ${activeEditor ? 'found' : 'none'}`);
        
        if (!activeEditor) {
            // No active file, try to use workspace folders
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceRepo = await this.findGitRepository(vscode.workspace.workspaceFolders[0].uri.fsPath);
                this.outputChannel.appendLine(`Workspace repo fallback: ${workspaceRepo}`);
                return workspaceRepo;
            }
            return null;
        }
        
        const filePath = activeEditor.document.uri.fsPath;
        this.outputChannel.appendLine(`Active file path: ${filePath}`);
        const repo = await this.findGitRepository(path.dirname(filePath));
        this.outputChannel.appendLine(`Found repo from active file: ${repo}`);
        return repo;
    }

    /**
     * Get stale branches from a specific repository
     */
    private async getStaleBranches(repositoryPath: string): Promise<StaleBranch[]> {
        const staleBranches: StaleBranch[] = [];
        const repositoryName = path.basename(repositoryPath);
        
        try {
            const git: SimpleGit = simpleGit(repositoryPath);
            
            // Fetch to ensure we have latest remote information
            await git.fetch(['--prune']);
            
            // Get all local branches
            const localBranches = await git.branchLocal();
            
            // Get all remote tracking branches
            const remoteBranches = await git.branch(['-r']);
            
            for (const branchName of localBranches.all) {
                // Skip current branch and main/master branches
                if (branchName === localBranches.current || 
                    branchName === 'main' || 
                    branchName === 'master') {
                    continue;
                }
                
                // Check if this local branch has a corresponding remote branch
                const remoteNames = (remoteBranches.all as string[]).map((r: string) => r.replace('origin/', ''));
                const hasRemote = remoteNames.includes(branchName);
                
                this.outputChannel.appendLine(`Checking branch: ${branchName}, hasRemote: ${hasRemote}`);
                
                if (!hasRemote) {
                    // Check if branch had remote tracking configuration (even if remote is gone)
                    try {
                        // Check if branch has/had upstream configuration
                        const upstream = await git.raw(['config', '--get', `branch.${branchName}.remote`]);
                        this.outputChannel.appendLine(`  Branch ${branchName} remote config: "${upstream.trim()}"`);
                        if (upstream.trim()) {
                            // Had remote tracking, but remote branch is gone - this is stale
                            this.outputChannel.appendLine(`  → STALE: ${branchName} had remote tracking but remote is gone`);
                            staleBranches.push({
                                name: branchName,
                                repositoryPath,
                                repositoryName
                            });
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`  Branch ${branchName} has no remote config: ${error}`);
                        // No remote config - check if it was ever pushed by looking at reflog
                        try {
                            const reflog = await git.raw(['reflog', '--all', '--grep=origin', `--grep=${branchName}`, '--']);
                            if (reflog.trim()) {
                                // Has origin references in reflog, likely stale
                                staleBranches.push({
                                    name: branchName,
                                    repositoryPath,
                                    repositoryName
                                });
                            }
                        } catch {
                            // Ignore branches that never had remote tracking
                        }
                    }
                }
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`Error processing repository ${repositoryName}: ${error}`);
        }
        
        return staleBranches;
    }

    /**
     * Prune stale branches with user confirmation
     */
    public async pruneStaleProBranches(): Promise<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Git Branch Pruner",
            cancellable: true
        }, async (progress, token) => {
            return this.executePruning(progress, token);
        });
    }

    /**
     * Execute the pruning process with progress reporting
     */
    private async executePruning(progress: vscode.Progress<{message?: string, increment?: number}>, token: vscode.CancellationToken): Promise<void> {
        const config = vscode.workspace.getConfiguration('gitBranchPruner');
        const pruneAllRepos = config.get<boolean>('pruneAllWorkspaceRepos', false);
        const showNotifications = config.get<boolean>('showNotifications', true);
        const identifyOnly = config.get<boolean>('identifyOnly', false);
        
        let repositories: string[] = [];
        
        this.statusBarItem.text = "$(loading~spin) Searching...";
        progress.report({ message: "Finding git repositories..." });
        
        this.outputChannel.appendLine(`Settings: pruneAllRepos=${pruneAllRepos}`);
        
        if (pruneAllRepos) {
            repositories = await this.getWorkspaceGitRepositories();
            this.outputChannel.appendLine(`Found ${repositories.length} workspace repositories: ${repositories.join(', ')}`);
        } else {
            const activeRepo = await this.getActiveRepository();
            this.outputChannel.appendLine(`Active repository: ${activeRepo}`);
            if (activeRepo) {
                repositories = [activeRepo];
            }
        }
        
        if (repositories.length === 0) {
            this.statusBarItem.text = "$(git-branch) Prune";
            this.outputChannel.appendLine('No git repositories found!');
            if (showNotifications) {
                vscode.window.showInformationMessage('No git repositories found');
            }
            return;
        }
        
        this.outputChannel.appendLine(`Checking ${repositories.length} repository(ies) for stale branches...`);
        progress.report({ message: `Analyzing ${repositories.length} repositories...` });
        this.statusBarItem.text = "$(loading~spin) Analyzing...";
        
        const allStaleBranches: StaleBranch[] = [];
        
        for (let i = 0; i < repositories.length; i++) {
            if (token.isCancellationRequested) {
                this.statusBarItem.text = "$(git-branch) Prune";
                return;
            }
            
            const repo = repositories[i];
            const repoName = path.basename(repo);
            progress.report({ 
                message: `Checking ${repoName} (${i + 1}/${repositories.length})...`,
                increment: (100 / repositories.length)
            });
            
            const staleBranches = await this.getStaleBranches(repo);
            allStaleBranches.push(...staleBranches);
        }
        
        this.statusBarItem.text = "$(git-branch) Prune";
        
        if (allStaleBranches.length === 0) {
            if (showNotifications) {
                vscode.window.showInformationMessage('No stale branches found');
            }
            this.outputChannel.appendLine('No stale branches found');
            return;
        }
        
        // Show confirmation dialog
        const branchList = allStaleBranches.map(b => `${b.repositoryName}: ${b.name}`).join('\n');
        const action = identifyOnly ? 'show' : 'delete';
        const message = `Found ${allStaleBranches.length} local stale branch(es). ${identifyOnly ? 'Identify' : 'Delete'} them?\n\n${branchList}`;
        
        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            identifyOnly ? 'Identify' : 'Delete',
            'Cancel'
        );
        
        if (choice !== (identifyOnly ? 'Identify' : 'Delete')) {
            return;
        }
        
        if (identifyOnly) {
            this.outputChannel.appendLine('IDENTIFY ONLY - Found the following stale branches:');
            for (const branch of allStaleBranches) {
                this.outputChannel.appendLine(`  ${branch.repositoryName}: ${branch.name}`);
            }
            if (showNotifications) {
                vscode.window.showInformationMessage(`Identify complete. Check output for details.`);
            }
            return;
        }
        
        // Actually delete the branches
        progress.report({ message: "Deleting stale branches..." });
        this.statusBarItem.text = "$(loading~spin) Deleting...";
        
        let deletedCount = 0;
        for (let i = 0; i < allStaleBranches.length; i++) {
            if (token.isCancellationRequested) {
                this.statusBarItem.text = "$(git-branch) Prune";
                return;
            }
            
            const branch = allStaleBranches[i];
            progress.report({ 
                message: `Deleting ${branch.name} (${i + 1}/${allStaleBranches.length})...`,
                increment: (100 / allStaleBranches.length)
            });
            
            try {
                const git: SimpleGit = simpleGit(branch.repositoryPath);
                await git.deleteLocalBranch(branch.name, true); // Force delete
                this.outputChannel.appendLine(`Deleted branch: ${branch.repositoryName}/${branch.name}`);
                deletedCount++;
            } catch (error) {
                this.outputChannel.appendLine(`Failed to delete ${branch.repositoryName}/${branch.name}: ${error}`);
            }
        }
        
        this.statusBarItem.text = "$(git-branch) Prune";
        
        if (showNotifications) {
            vscode.window.showInformationMessage(`Deleted ${deletedCount} stale branch(es)`);
        }
        this.outputChannel.appendLine(`Pruning complete. Deleted ${deletedCount} branch(es)`);
    }

    /**
     * Prune stale branches from active repository only
     */
    public async pruneStaleActiveRepository(): Promise<void> {
        const activeRepo = await this.getActiveRepository();
        if (!activeRepo) {
            vscode.window.showErrorMessage('No active git repository found');
            return;
        }
        
        // Temporarily override the setting for this command
        const config = vscode.workspace.getConfiguration('gitBranchPruner');
        await config.update('pruneAllWorkspaceRepos', false, vscode.ConfigurationTarget.Global);
        
        try {
            await this.pruneStaleProBranches();
        } finally {
            // Don't restore the original setting as user might want to keep this change
        }
    }

    /**
     * Show status of pruneable branches without deleting
     */
    public async showPruneableStatus(): Promise<void> {
        const config = vscode.workspace.getConfiguration('gitBranchPruner');
        const originalIdentifyOnly = config.get<boolean>('identifyOnly', false);
        
        // Temporarily enable identify only mode
        await config.update('identifyOnly', true, vscode.ConfigurationTarget.Global);
        
        try {
            await this.pruneStaleProBranches();
        } finally {
            // Restore original identify only setting
            await config.update('identifyOnly', originalIdentifyOnly, vscode.ConfigurationTarget.Global);
        }
    }

    /**
     * Show menu with prune options
     */
    public async showPruneMenu(): Promise<void> {
        const items = [
            {
                label: "$(git-branch) Prune Stale Local Branches",
                description: "Delete local branches that no longer exist on remote",
                action: 'prune'
            },
            {
                label: "$(eye) Identify Stale Branches",
                description: "Show which branches are stale without deleting them",
                action: 'identify'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select an action for stale git branches",
            matchOnDescription: true
        });

        if (selected) {
            switch (selected.action) {
                case 'prune':
                    await this.pruneStaleProBranches();
                    break;
                case 'identify':
                    await this.showPruneableStatus();
                    break;
            }
        }
    }

    /**
     * Show notification when stale branches are found by auto-scan
     */
    private async showStaleFoundNotification(reposWithStaleBranches: {[repoName: string]: StaleBranch[]}, totalCount: number): Promise<void> {
        const repoNames = Object.keys(reposWithStaleBranches);
        const repoList = repoNames.map(name => {
            const count = reposWithStaleBranches[name].length;
            return `${name} (${count} branch${count > 1 ? 'es' : ''})`;
        }).join(', ');

        const message = `Found ${totalCount} stale local branch${totalCount > 1 ? 'es' : ''} in: ${repoList}`;

        const config = vscode.workspace.getConfiguration('gitBranchPruner');
        const identifyOnly = config.get<boolean>('identifyOnly', false);

        if (identifyOnly) {
            // Identify Only mode - just show snooze option
            const choice = await vscode.window.showInformationMessage(message, 'Snooze');
            if (choice === 'Snooze') {
                await this.showSnoozeOptions();
            }
        } else {
            // Normal mode - show prune options
            const choice = await vscode.window.showInformationMessage(
                message, 
                'Prune Now', 
                'Snooze'
            );

            if (choice) {
                switch (choice) {
                    case 'Prune Now':
                        await this.pruneStaleProBranches();
                        break;
                    case 'Snooze':
                        await this.showSnoozeOptions();
                        break;
                }
            }
        }
    }

    /**
     * Show snooze duration options
     */
    private async showSnoozeOptions(): Promise<void> {
        const options = [
            {
                label: '1 hour',
                description: 'Pause auto-scan notifications for 1 hour',
                hours: 1
            },
            {
                label: '4 hours',
                description: 'Pause auto-scan notifications for 4 hours',
                hours: 4
            },
            {
                label: '24 hours',
                description: 'Pause auto-scan notifications for 1 day',
                hours: 24
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'How long would you like to snooze auto-scan notifications?'
        });

        if (selected) {
            this.snoozeNotifications(selected.hours);
        }
    }

    /**
     * Snooze notifications for specified hours
     */
    private snoozeNotifications(hours: number): void {
        this.notificationSnoozeUntil = Date.now() + (hours * 60 * 60 * 1000);
        this.outputChannel.appendLine(`Notifications snoozed for ${hours} hour(s)`);
        vscode.window.showInformationMessage(`Auto-scan notifications snoozed for ${hours} hour(s)`);
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        if (this.autoScanTimer) {
            clearInterval(this.autoScanTimer);
        }
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}

let pruner: GitBranchPruner | undefined;

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Git Branch Pruner extension is now active');
    
    pruner = new GitBranchPruner(context);
    
    // Register commands
    const commands = [
        vscode.commands.registerCommand('gitBranchPruner.showMenu', () => {
            pruner?.showPruneMenu();
        }),
        vscode.commands.registerCommand('gitBranchPruner.pruneStale', () => {
            pruner?.pruneStaleProBranches();
        }),
        vscode.commands.registerCommand('gitBranchPruner.pruneStaleActiveRepo', () => {
            pruner?.pruneStaleActiveRepository();
        }),
        vscode.commands.registerCommand('gitBranchPruner.showPruneableStatus', () => {
            pruner?.showPruneableStatus();
        })

    ];
    
    context.subscriptions.push(...commands);
    context.subscriptions.push(pruner);
}

/**
 * Extension deactivation function
 */
export function deactivate() {
    if (pruner) {
        pruner.dispose();
        pruner = undefined;
    }
}
