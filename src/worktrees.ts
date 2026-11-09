import * as fs from 'fs';
import * as path from 'path';
import { execGit } from './git';

/**
 * One workspace path, located within the repository it belongs to.
 */
export interface WorktreeInfo {
    /** The path as VS Code reported it */
    path: string;
    /** The shared .git directory. Every worktree of one repository has the same one. */
    commonDir: string;
    /** True for the repository's main worktree, false for one made with `git worktree add` */
    isMain: boolean;
}

/**
 * A repository to scan once, however many of its worktrees are open.
 */
export interface Repository {
    /** Worktree to run git commands in. Branches and remotes are shared, so any worktree works. */
    path: string;
    /** Display name, taken from the main repository folder rather than a worktree folder */
    name: string;
    /** Every workspace path that belongs to this repository, including `path` */
    worktrees: string[];
}

/**
 * Resolve symlinks (macOS tmp dirs, symlinked home folders) so two spellings of
 * one folder compare equal. Falls back to the plain path if it can't be resolved.
 */
function realPath(p: string): string {
    const resolved = path.resolve(p);
    try {
        return fs.realpathSync.native(resolved);
    } catch {
        return resolved;
    }
}

function pathKey(p: string): string {
    const real = realPath(p);
    return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * Locate a workspace path within its repository.
 *
 * `--git-common-dir` is relative (".git") in the main worktree and absolute in a
 * linked one, so both are resolved against the path. `--path-format=absolute`
 * would avoid that but needs git 2.31.
 */
export async function resolveWorktree(gitPath: string, repoPath: string): Promise<WorktreeInfo> {
    const output = await execGit(gitPath, repoPath, ['rev-parse', '--git-dir', '--git-common-dir']);
    const [gitDir, commonDir] = output.trim().split(/\r?\n/);
    if (!gitDir || !commonDir) {
        throw new Error(`unexpected rev-parse output: ${JSON.stringify(output)}`);
    }
    const common = realPath(path.resolve(repoPath, commonDir));
    return {
        path: repoPath,
        commonDir: common,
        // A linked worktree has its own git dir under .git/worktrees/<name>
        isMain: pathKey(path.resolve(repoPath, gitDir)) === pathKey(common)
    };
}

/**
 * Name a repository after the folder that holds its shared git directory:
 * "/code/app/.git" is "app", a bare "/code/app.git" is "app", and a submodule's
 * "/code/app/.git/modules/lib" is "lib".
 */
export function repositoryName(commonDir: string): string {
    const base = path.basename(commonDir);
    return base === '.git' ? path.basename(path.dirname(commonDir)) : base.replace(/\.git$/, '');
}

/**
 * Pick the worktree that git commands for the whole repository run in.
 * `members` all share one git directory and are in the order they were found:
 * repositories open in the Git extension first, then workspace folders.
 */
function choosePrimary(members: WorktreeInfo[]): WorktreeInfo {
    // TODO(human): choose which worktree represents the repository
    return members[0];
}

/**
 * Fold worktrees that share a git directory into one repository each, keeping
 * the order in which repositories were first seen.
 */
export function groupWorktrees(worktrees: WorktreeInfo[]): Repository[] {
    const groups = new Map<string, WorktreeInfo[]>();
    for (const worktree of worktrees) {
        const key = pathKey(worktree.commonDir);
        const members = groups.get(key);
        if (members) {
            members.push(worktree);
        } else {
            groups.set(key, [worktree]);
        }
    }
    return [...groups.values()].map(members => {
        const primary = choosePrimary(members);
        return {
            path: primary.path,
            name: repositoryName(primary.commonDir),
            worktrees: members.map(member => member.path)
        };
    });
}

export interface FindRepositoriesResult {
    repositories: Repository[];
    /** Paths that were dropped because their folder no longer exists */
    missing: string[];
}

/**
 * Turn candidate paths (Git extension repositories and workspace folders) into
 * distinct repositories. VS Code opens every worktree of a repository as its own
 * repository, and tools that create worktrees can delete the folder while it's
 * still listed, so both duplicates and missing folders are expected here.
 *
 * A path git can't resolve is kept as its own repository, so the scan still
 * reports the failure instead of quietly finding nothing.
 */
export async function findRepositories(gitPath: string, candidates: string[]): Promise<FindRepositoriesResult> {
    const missing: string[] = [];
    const seen = new Set<string>();
    const located: WorktreeInfo[] = [];

    for (const candidate of candidates) {
        const key = pathKey(candidate);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        if (!fs.existsSync(candidate)) {
            missing.push(candidate);
            continue;
        }
        try {
            located.push(await resolveWorktree(gitPath, candidate));
        } catch {
            located.push({ path: candidate, commonDir: candidate, isMain: true });
        }
    }
    return { repositories: groupWorktrees(located), missing };
}

/**
 * A worktree as reported by `git worktree list --porcelain`.
 */
export interface WorktreeEntry {
    path: string;
    /** Checked-out branch without "refs/heads/", or "" when detached or bare */
    branch: string;
    /** Its folder is gone, so `git worktree prune` would remove this record */
    prunable: boolean;
}

export const worktreeListArgs = ['worktree', 'list', '--porcelain'];

/**
 * Parse `git worktree list --porcelain`. Records are separated by blank lines.
 * The "prunable" annotation needs git 2.31; older versions just never report it.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
    const entries: WorktreeEntry[] = [];
    let current: WorktreeEntry | undefined;
    for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
            current = { path: line.slice('worktree '.length), branch: '', prunable: false };
            entries.push(current);
        } else if (!current) {
            continue;
        } else if (line.startsWith('branch refs/heads/')) {
            current.branch = line.slice('branch refs/heads/'.length);
        } else if (line === 'prunable' || line.startsWith('prunable ')) {
            current.prunable = true;
        }
    }
    return entries;
}

/**
 * Paths of worktrees whose folders were deleted without `git worktree remove`.
 * These match `%(worktreepath)` in for-each-ref exactly, since git reports both
 * from the same record.
 */
export function prunableWorktreePaths(output: string): Set<string> {
    return new Set(parseWorktreeList(output).filter(entry => entry.prunable).map(entry => entry.path));
}
