import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execGit, withTimeout } from './git';
import { BranchInfo, forEachRefArgs, findStaleBranches } from './staleBranches';
import type { API as GitAPI, GitExtension } from './types/git';

/**
 * A stale local branch together with the repository it lives in
 */
interface StaleBranch extends BranchInfo {
    repositoryPath: string;
    repositoryName: string;
}

type Scope = 'active' | 'all';

/**
 * Per-run options. Anything left out falls back to the user's settings.
 */
interface RunOptions {
    scope?: Scope;
    identifyOnly?: boolean;
}

interface ScanResult {
    branches: StaleBranch[];
    fetchFailures: string[];
    scanFailures: string[];
}

const minAutoScanMinutes = 15;
const firstAutoScanDelayMs = 30 * 1000;
const fetchTimeoutMs = 60 * 1000;
const defaultProtectedBranches = ['main', 'master', 'develop'];

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function plural(count: number, word: string, suffix = 'es'): string {
    return `${count} ${word}${count === 1 ? '' : suffix}`;
}

/**
 * Main extension class that handles git branch pruning functionality
 */
export class GitBranchPruner implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;
    private autoScanTimer: NodeJS.Timeout | undefined;
    private firstAutoScanTimer: NodeJS.Timeout | undefined;
    private notificationSnoozeUntil: number = 0;
    private busy = false;
    private warnedAboutFetch = false;
    private lastScan: { at: number, branches: StaleBranch[] } | undefined;
    private gitApi: GitAPI | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Git Branch Pruner');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'gitBranchPruner.showMenu';
        this.updateStatusBar();
        this.statusBarItem.show();

        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('gitBranchPruner.autoScanInterval')) {
                this.setupAutoScan();
            }
        }));
        this.setupAutoScan();
    }

    private get config(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('gitBranchPruner');
    }

    private log(message: string): void {
        this.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
    }

    /**
     * Show the stale branch count from the last scan, or a spinner while busy
     */
    private updateStatusBar(busyText?: string): void {
        if (busyText) {
            this.statusBarItem.text = `$(loading~spin) ${busyText}`;
            return;
        }
        const count = this.lastScan?.branches.length ?? 0;
        this.statusBarItem.text = count > 0 ? `$(git-branch) Prune (${count})` : '$(git-branch) Prune';
        this.statusBarItem.tooltip = count > 0
            ? `${plural(count, 'stale branch')} found. Click to review.`
            : 'Click to manage stale git branches';
    }

    /**
     * Auto-scan interval in minutes, or 0 when disabled. Non-zero values are clamped to the minimum.
     */
    private getAutoScanMinutes(): number {
        const minutes = this.config.get<number>('autoScanInterval', 60);
        if (!minutes || minutes <= 0) {
            return 0;
        }
        return Math.max(minutes, minAutoScanMinutes);
    }

    /**
     * Set up automatic scanning based on configuration
     */
    private setupAutoScan(): void {
        clearInterval(this.autoScanTimer);
        clearTimeout(this.firstAutoScanTimer);
        this.autoScanTimer = undefined;
        this.firstAutoScanTimer = undefined;

        const minutes = this.getAutoScanMinutes();
        if (minutes === 0) {
            this.log('Auto-scan disabled (interval = 0)');
            return;
        }

        this.firstAutoScanTimer = setTimeout(() => this.runAutomaticScan(), firstAutoScanDelayMs);
        this.autoScanTimer = setInterval(() => this.runAutomaticScan(), minutes * 60 * 1000);
        this.log(`Auto-scan scheduled every ${minutes} minutes`);
    }

    /**
     * Run the given work unless another scan or delete is already in progress
     */
    private async exclusive<T>(work: () => Thenable<T>): Promise<T | undefined> {
        if (this.busy) {
            return undefined;
        }
        this.busy = true;
        try {
            return await work();
        } finally {
            this.busy = false;
            this.updateStatusBar();
        }
    }

    // ---------------------------------------------------------------- repositories

    /**
     * The built-in Git extension's API, if it's installed and enabled.
     * In Remote - WSL it runs in the same extension host as this extension.
     */
    private async getGitApi(): Promise<GitAPI | undefined> {
        if (this.gitApi) {
            return this.gitApi;
        }
        try {
            const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!extension) {
                return undefined;
            }
            const gitExtension = extension.isActive ? extension.exports : await extension.activate();
            if (gitExtension.enabled) {
                this.gitApi = gitExtension.getAPI(1);
            }
        } catch (error) {
            this.log(`Built-in Git extension unavailable, falling back to "git" on PATH: ${errorMessage(error)}`);
        }
        return this.gitApi;
    }

    private get gitPath(): string {
        return this.gitApi?.git.path || 'git';
    }

    /**
     * Walk up from a path until a folder containing .git is found
     */
    private findGitRepository(startPath: string): string | null {
        let currentPath = startPath;
        while (currentPath !== path.dirname(currentPath)) {
            if (fs.existsSync(path.join(currentPath, '.git'))) {
                return currentPath;
            }
            currentPath = path.dirname(currentPath);
        }
        return null;
    }

    private repositoryFor(uri: vscode.Uri): string | null {
        const repository = this.gitApi?.getRepository(uri);
        return repository ? repository.rootUri.fsPath : this.findGitRepository(uri.fsPath);
    }

    /**
     * All git repositories in the workspace: those the Git extension has open, plus
     * the repository containing each workspace folder
     */
    private async getWorkspaceGitRepositories(): Promise<string[]> {
        const api = await this.getGitApi();
        const found = new Map<string, string>();
        const add = (repoPath: string | null) => {
            if (repoPath) {
                const key = process.platform === 'win32' ? repoPath.toLowerCase() : repoPath;
                found.set(key, repoPath);
            }
        };

        api?.repositories.forEach(repository => add(repository.rootUri.fsPath));
        vscode.workspace.workspaceFolders?.forEach(folder => add(this.repositoryFor(folder.uri)));
        return [...found.values()];
    }

    /**
     * The repository of the active file, or of the first workspace folder
     */
    private async getActiveRepository(): Promise<string | null> {
        await this.getGitApi();
        const uri = vscode.window.activeTextEditor?.document.uri;
        // Ignore the Output panel, untitled files and other non-file editors
        if (uri?.scheme === 'file') {
            const repo = this.repositoryFor(uri);
            if (repo) {
                return repo;
            }
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? this.repositoryFor(folder.uri) : null;
    }

    private async getRepositories(scope: Scope): Promise<string[]> {
        if (scope === 'all') {
            return this.getWorkspaceGitRepositories();
        }
        const repo = await this.getActiveRepository();
        return repo ? [repo] : [];
    }

    // ---------------------------------------------------------------- scanning

    /**
     * Fetch with --prune so deleted remote branches show up as [gone].
     * Prefers the Git extension, which routes credentials through VS Code; a plain
     * git process has no way to ask for them (e.g. HTTPS remotes in WSL).
     */
    private async fetchRepository(repoPath: string): Promise<void> {
        const repository = (await this.getGitApi())?.getRepository(vscode.Uri.file(repoPath));
        const fetch = repository
            ? repository.fetch({ all: true, prune: true })
            : execGit(this.gitPath, repoPath, ['fetch', '--all', '--prune'], fetchTimeoutMs);
        await withTimeout(Promise.resolve(fetch), fetchTimeoutMs, `fetch timed out after ${fetchTimeoutMs / 1000}s`);
    }

    /**
     * Fetch and classify branches in each repository. A failed fetch doesn't stop
     * detection; it just means the results reflect the last successful fetch.
     */
    private async scan(
        repositories: string[],
        progress?: vscode.Progress<{ message?: string, increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<ScanResult | undefined> {
        const protectedBranches = this.config.get<string[]>('protectedBranches', defaultProtectedBranches);
        const result: ScanResult = { branches: [], fetchFailures: [], scanFailures: [] };
        this.updateStatusBar('Scanning...');

        for (const [index, repositoryPath] of repositories.entries()) {
            if (token?.isCancellationRequested) {
                return undefined;
            }
            const repositoryName = path.basename(repositoryPath);
            progress?.report({
                message: `Checking ${repositoryName} (${index + 1}/${repositories.length})...`,
                increment: 100 / repositories.length
            });

            try {
                await this.fetchRepository(repositoryPath);
            } catch (error) {
                this.log(`Fetch failed for ${repositoryName}: ${errorMessage(error)}`);
                result.fetchFailures.push(repositoryName);
            }

            try {
                const output = await execGit(this.gitPath, repositoryPath, forEachRefArgs);
                const stale = findStaleBranches(output, protectedBranches);
                this.log(`${repositoryName}: ${plural(stale.length, 'stale branch')}${stale.length ? ` (${stale.map(b => b.name).join(', ')})` : ''}`);
                result.branches.push(...stale.map(branch => ({ ...branch, repositoryPath, repositoryName })));
            } catch (error) {
                this.log(`Could not read branches in ${repositoryName}: ${errorMessage(error)}`);
                result.scanFailures.push(repositoryName);
            }
        }

        this.lastScan = { at: Date.now(), branches: result.branches };
        return result;
    }

    private async reportScanProblems(result: ScanResult): Promise<void> {
        const problems: string[] = [];
        if (result.fetchFailures.length) {
            problems.push(`Couldn't fetch ${result.fetchFailures.join(', ')}, so results reflect the last successful fetch.`);
        }
        if (result.scanFailures.length) {
            problems.push(`Couldn't read branches in ${result.scanFailures.join(', ')}.`);
        }
        if (problems.length === 0) {
            return;
        }
        const choice = await vscode.window.showWarningMessage(`Git Branch Pruner: ${problems.join(' ')}`, 'Show Output');
        if (choice === 'Show Output') {
            this.outputChannel.show();
        }
    }

    // ---------------------------------------------------------------- commands

    /**
     * Scan, then let the user pick which stale branches to delete in a single step
     */
    public async runPrune(options: RunOptions = {}): Promise<void> {
        const scope = options.scope ?? (this.config.get<boolean>('pruneAllWorkspaceRepos', false) ? 'all' : 'active');
        const identifyOnly = options.identifyOnly ?? this.config.get<boolean>('identifyOnly', false);
        const showNotifications = this.config.get<boolean>('showNotifications', true);

        if (this.busy) {
            vscode.window.showInformationMessage('Git Branch Pruner is already running.');
            return;
        }

        const repositories = await this.getRepositories(scope);
        this.log(`Manual ${identifyOnly ? 'identify' : 'prune'} (${scope}): ${repositories.join(', ') || 'no repositories'}`);
        if (repositories.length === 0) {
            if (showNotifications) {
                vscode.window.showInformationMessage('No git repositories found');
            }
            return;
        }

        const result = await this.exclusive(() => vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Git Branch Pruner',
            cancellable: true
        }, (progress, token) => this.scan(repositories, progress, token)));
        if (!result) {
            return;
        }

        void this.reportScanProblems(result);
        if (result.branches.length === 0) {
            if (showNotifications) {
                vscode.window.showInformationMessage('No stale branches found');
            }
            return;
        }
        await this.reviewBranches(result.branches, identifyOnly);
    }

    /**
     * Show stale branches in a picker. In prune mode every branch starts ticked and
     * pressing Enter deletes the ticked ones; this is the only confirmation.
     */
    private async reviewBranches(branches: StaleBranch[], identifyOnly: boolean): Promise<void> {
        const multipleRepos = new Set(branches.map(b => b.repositoryPath)).size > 1;
        const items = branches.map(branch => ({
            label: branch.name,
            description: multipleRepos ? `${branch.repositoryName} · ${branch.upstream} gone` : `${branch.upstream} gone`,
            detail: [branch.lastCommitDate, branch.subject].filter(Boolean).join(' · '),
            picked: true,
            branch
        }));

        if (identifyOnly) {
            this.log('Identify only, stale branches:');
            branches.forEach(b => this.log(`  ${b.repositoryName}: ${b.name}`));
            await vscode.window.showQuickPick(items, {
                title: 'Stale branches (identify only, nothing will be deleted)',
                placeHolder: `${plural(branches.length, 'stale branch')} found`
            });
            return;
        }

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Delete stale branches',
            placeHolder: `${plural(branches.length, 'stale branch')}: untick any to keep, then press Enter to delete`,
            canPickMany: true,
            matchOnDescription: true
        });
        if (!selected || selected.length === 0) {
            return;
        }
        await this.deleteBranches(selected.map(item => item.branch));
    }

    private async deleteBranches(branches: StaleBranch[]): Promise<void> {
        if (this.busy) {
            vscode.window.showInformationMessage('Git Branch Pruner is busy scanning. Try again in a moment.');
            return;
        }
        const deleted: StaleBranch[] = [];
        const failed: StaleBranch[] = [];

        await this.exclusive(() => vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Deleting stale branches'
        }, async progress => {
            this.updateStatusBar('Deleting...');
            for (const branch of branches) {
                progress.report({ message: branch.name, increment: 100 / branches.length });
                try {
                    // -D because squash/rebase merges leave the branch "unmerged" from git's view
                    await execGit(this.gitPath, branch.repositoryPath, ['branch', '-D', branch.name]);
                    this.log(`Deleted ${branch.repositoryName}/${branch.name}`);
                    deleted.push(branch);
                } catch (error) {
                    this.log(`Failed to delete ${branch.repositoryName}/${branch.name}: ${errorMessage(error)}`);
                    failed.push(branch);
                }
            }
        }));

        if (this.lastScan) {
            this.lastScan.branches = this.lastScan.branches.filter(b => !deleted.includes(b));
            this.updateStatusBar();
        }

        if (failed.length) {
            const choice = await vscode.window.showWarningMessage(
                `Deleted ${plural(deleted.length, 'branch')}. Couldn't delete ${failed.map(b => b.name).join(', ')}.`,
                'Show Output'
            );
            if (choice === 'Show Output') {
                this.outputChannel.show();
            }
        } else if (this.config.get<boolean>('showNotifications', true)) {
            vscode.window.showInformationMessage(`Deleted ${plural(deleted.length, 'stale branch')}`);
        }
    }

    /**
     * Show menu with prune options
     */
    public async showPruneMenu(): Promise<void> {
        const items = [
            {
                label: 'Prune Stale Local Branches',
                description: 'Delete local branches whose remote branch is gone',
                identifyOnly: false
            },
            {
                label: 'Identify Stale Branches',
                description: 'Show which branches are stale without deleting them',
                identifyOnly: true
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an action for stale git branches',
            matchOnDescription: true
        });
        if (selected) {
            await this.runPrune({ identifyOnly: selected.identifyOnly });
        }
    }

    // ---------------------------------------------------------------- auto-scan

    /**
     * Scan all workspace repositories in the background and notify if stale branches are found
     */
    public async runAutomaticScan(): Promise<void> {
        const now = Date.now();
        if (now < this.notificationSnoozeUntil) {
            const minutesLeft = Math.round((this.notificationSnoozeUntil - now) / (60 * 1000));
            this.log(`Auto-scan skipped: snoozed for ${minutesLeft} more minutes`);
            return;
        }

        try {
            const repositories = await this.getWorkspaceGitRepositories();
            if (repositories.length === 0) {
                return;
            }
            this.log(`Auto-scan: ${repositories.join(', ')}`);
            const result = await this.exclusive(() => this.scan(repositories));
            if (!result) {
                this.log('Auto-scan skipped: another scan is running');
                return;
            }
            // Warn once per session so a broken fetch (e.g. no credentials in WSL) isn't silent
            if (result.fetchFailures.length && !this.warnedAboutFetch) {
                this.warnedAboutFetch = true;
                void this.reportScanProblems(result);
            }
            if (result.branches.length > 0) {
                await this.showStaleFoundNotification(result.branches);
            }
        } catch (error) {
            this.log(`Auto-scan failed: ${errorMessage(error)}`);
        }
    }

    /**
     * Notify about branches found by auto-scan. "Prune Now" opens the picker with
     * these results directly instead of scanning and confirming all over again.
     */
    private async showStaleFoundNotification(branches: StaleBranch[]): Promise<void> {
        const counts = new Map<string, number>();
        branches.forEach(b => counts.set(b.repositoryName, (counts.get(b.repositoryName) ?? 0) + 1));
        const repoList = [...counts].map(([name, count]) => `${name} (${count})`).join(', ');
        const message = `Found ${plural(branches.length, 'stale local branch')} in: ${repoList}`;

        const identifyOnly = this.config.get<boolean>('identifyOnly', false);
        const reviewLabel = identifyOnly ? 'Show' : 'Prune Now';
        const choice = await vscode.window.showInformationMessage(message, reviewLabel, 'Snooze');

        if (choice === reviewLabel) {
            // Use the freshest results in case a manual run or delete happened while the toast was up
            const latest = this.lastScan?.branches ?? branches;
            if (latest.length === 0) {
                vscode.window.showInformationMessage('No stale branches left');
                return;
            }
            await this.reviewBranches(latest, identifyOnly);
        } else if (choice === 'Snooze') {
            await this.showSnoozeOptions();
        }
    }

    /**
     * Show snooze duration options
     */
    private async showSnoozeOptions(): Promise<void> {
        const options = [1, 4, 24].map(hours => {
            const label = hours === 1 ? '1 hour' : `${hours} hours`;
            return { label, description: `Pause auto-scan notifications for ${label}`, hours };
        });

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'How long would you like to snooze auto-scan notifications?'
        });
        if (selected) {
            this.notificationSnoozeUntil = Date.now() + selected.hours * 60 * 60 * 1000;
            this.log(`Notifications snoozed for ${selected.label}`);
            vscode.window.showInformationMessage(`Auto-scan notifications snoozed for ${selected.label}`);
        }
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        clearInterval(this.autoScanTimer);
        clearTimeout(this.firstAutoScanTimer);
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}

let pruner: GitBranchPruner | undefined;

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext) {
    pruner = new GitBranchPruner(context);
    const instance = pruner;

    context.subscriptions.push(
        vscode.commands.registerCommand('gitBranchPruner.showMenu', () => instance.showPruneMenu()),
        vscode.commands.registerCommand('gitBranchPruner.pruneStale', () => instance.runPrune()),
        vscode.commands.registerCommand('gitBranchPruner.pruneStaleActiveRepo', () => instance.runPrune({ scope: 'active' })),
        vscode.commands.registerCommand('gitBranchPruner.showPruneableStatus', () => instance.runPrune({ identifyOnly: true })),
        instance
    );
}

/**
 * Extension deactivation function. Resources are disposed through context.subscriptions.
 */
export function deactivate() {
    pruner = undefined;
}
