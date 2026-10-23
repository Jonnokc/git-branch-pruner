/**
 * A local branch as reported by `git for-each-ref refs/heads`.
 */
export interface BranchInfo {
    name: string;
    /** Upstream ref, e.g. "origin/feature". Empty if the branch never tracked a remote. */
    upstream: string;
    /** "[gone]" once the upstream was deleted and pruned, otherwise e.g. "[ahead 1]" or "". */
    track: string;
    /** True for the branch checked out in this worktree. */
    isHead: boolean;
    /** Path of the worktree that has this branch checked out, or "" if none does. */
    worktreePath: string;
    lastCommitDate: string;
    subject: string;
}

// Fields are NUL-separated (%00) so branch names and commit subjects can't break parsing.
const FIELDS = [
    '%(refname:short)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(HEAD)',
    '%(worktreepath)',
    '%(committerdate:relative)',
    '%(contents:subject)'
];

export const forEachRefArgs = ['for-each-ref', `--format=${FIELDS.join('%00')}`, 'refs/heads'];

/**
 * Parse the output of `git <forEachRefArgs>` into branch records.
 */
export function parseBranches(output: string): BranchInfo[] {
    return output
        .split(/\r?\n/)
        .filter(line => line.length > 0)
        .map(line => {
            const [name, upstream, track, head, worktreePath, lastCommitDate, subject] = line.split('\0');
            return {
                name,
                upstream: upstream ?? '',
                track: track ?? '',
                isHead: head === '*',
                worktreePath: worktreePath ?? '',
                lastCommitDate: lastCommitDate ?? '',
                subject: subject ?? ''
            };
        });
}

/**
 * Decide whether a local branch is safe to offer for deletion.
 */
export function isStale(branch: BranchInfo, protectedBranches: readonly string[]): boolean {
    if (!branch.upstream || branch.track !== '[gone]') {
        return false; // never pushed, or the remote branch still exists
    }
    if (protectedBranches.includes(branch.name)) {
        return false;
    }
    // Git refuses to delete a checked-out branch, and it's likely still in use
    return !branch.isHead && branch.worktreePath === '';
}

/**
 * Parse for-each-ref output and return only the stale branches.
 */
export function findStaleBranches(output: string, protectedBranches: readonly string[]): BranchInfo[] {
    return parseBranches(output).filter(branch => isStale(branch, protectedBranches));
}
