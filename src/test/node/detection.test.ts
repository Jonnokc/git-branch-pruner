import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execGit } from '../../git';
import { classifyBranches, findStaleBranches, forEachRefArgs } from '../../staleBranches';
import { findRepositories, prunableWorktreePaths, worktreeListArgs } from '../../worktrees';

/**
 * End-to-end detection against real git: a bare "remote", a clone, and
 * remote branches deleted behind the clone's back.
 */
suite('stale branch detection (real git)', function () {
    this.timeout(30 * 1000);

    let root: string;
    let work: string;
    let wipTree: string;
    let goneTree: string;
    const git = (cwd: string, ...args: string[]) => execGit('git', cwd, args);
    const protectedBranches = ['main', 'master', 'develop'];

    suiteSetup(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-pruner-'));
        const remote = path.join(root, 'remote.git');
        work = path.join(root, 'work');
        wipTree = path.join(root, 'wip-tree');
        goneTree = path.join(root, 'gone-tree');

        await git(root, 'init', '--bare', remote);
        await git(root, 'clone', remote, work);
        await git(work, 'config', 'user.name', 'Test');
        await git(work, 'config', 'user.email', 'test@example.com');
        await git(work, 'checkout', '-b', 'main');
        await git(work, 'commit', '--allow-empty', '-m', 'initial');
        await git(work, 'push', '-u', 'origin', 'main');

        for (const name of ['feature', 'develop', 'wip', 'current', 'still-live', 'abandoned']) {
            await git(work, 'branch', name);
            await git(work, 'push', '-u', 'origin', name);
        }
        await git(work, 'branch', 'local-only');
        await git(work, 'worktree', 'add', wipTree, 'wip');
        await git(work, 'checkout', 'current');

        // A tool creates a worktree, then deletes its folder without `git worktree remove`
        await git(work, 'worktree', 'add', goneTree, 'abandoned');
        fs.rmSync(goneTree, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

        // Someone else deletes these on the remote
        for (const name of ['feature', 'develop', 'wip', 'current', 'abandoned']) {
            await git(remote, 'branch', '-D', name);
        }
        await git(work, 'fetch', '--prune');
    });

    suiteTeardown(() => {
        // On Windows a lingering file handle (e.g. VS Code's file watcher) can briefly block deletion
        try {
            fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch (error) {
            console.warn(`Could not remove temp repo ${root}: ${error}`);
        }
    });

    test('only the unprotected, not-checked-out, gone branch is stale', async () => {
        const output = await git(work, ...forEachRefArgs);
        const stale = findStaleBranches(output, protectedBranches).map(b => b.name);
        assert.deepStrictEqual(stale, ['feature']);
    });

    test('worktrees of one repository are scanned once, from the main worktree', async () => {
        for (const candidates of [[work, wipTree], [wipTree, work]]) {
            const { repositories, missing } = await findRepositories('git', candidates);
            assert.strictEqual(repositories.length, 1, `one repository for ${candidates.join(', ')}`);
            assert.strictEqual(repositories[0].path, work);
            assert.strictEqual(repositories[0].name, 'work');
            assert.deepStrictEqual(repositories[0].worktrees, candidates);
            assert.deepStrictEqual(missing, []);
        }
    });

    test('a worktree whose folder was deleted is skipped, not scanned', async () => {
        const { repositories, missing } = await findRepositories('git', [goneTree, work]);
        assert.deepStrictEqual(repositories.map(r => r.path), [work]);
        assert.deepStrictEqual(missing, [goneTree]);
    });

    test('a branch held by a deleted worktree is reported as held, not stale', async () => {
        const prunable = prunableWorktreePaths(await git(work, ...worktreeListArgs));
        const { stale, held } = classifyBranches(await git(work, ...forEachRefArgs), protectedBranches, prunable);
        assert.deepStrictEqual(stale.map(b => b.name), ['feature']);
        assert.deepStrictEqual(held.map(b => b.name), ['abandoned']);
    });

    // Mutates the fixture, so it runs last
    test('git worktree prune releases the held branch so it can be deleted', async () => {
        await git(work, 'worktree', 'prune');
        const stale = findStaleBranches(await git(work, ...forEachRefArgs), protectedBranches).map(b => b.name);
        assert.deepStrictEqual(stale, ['abandoned', 'feature']);
        await git(work, 'branch', '-D', 'abandoned');
    });
});
