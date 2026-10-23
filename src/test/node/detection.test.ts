import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execGit } from '../../git';
import { findStaleBranches, forEachRefArgs } from '../../staleBranches';

/**
 * End-to-end detection against real git: a bare "remote", a clone, and
 * remote branches deleted behind the clone's back.
 */
suite('stale branch detection (real git)', function () {
    this.timeout(30 * 1000);

    let root: string;
    let work: string;
    const git = (cwd: string, ...args: string[]) => execGit('git', cwd, args);

    suiteSetup(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-pruner-'));
        const remote = path.join(root, 'remote.git');
        work = path.join(root, 'work');

        await git(root, 'init', '--bare', remote);
        await git(root, 'clone', remote, work);
        await git(work, 'config', 'user.name', 'Test');
        await git(work, 'config', 'user.email', 'test@example.com');
        await git(work, 'checkout', '-b', 'main');
        await git(work, 'commit', '--allow-empty', '-m', 'initial');
        await git(work, 'push', '-u', 'origin', 'main');

        for (const name of ['feature', 'develop', 'wip', 'current', 'still-live']) {
            await git(work, 'branch', name);
            await git(work, 'push', '-u', 'origin', name);
        }
        await git(work, 'branch', 'local-only');
        await git(work, 'worktree', 'add', path.join(root, 'wip-tree'), 'wip');
        await git(work, 'checkout', 'current');

        // Someone else deletes these on the remote
        for (const name of ['feature', 'develop', 'wip', 'current']) {
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
        const stale = findStaleBranches(output, ['main', 'master', 'develop']).map(b => b.name);
        assert.deepStrictEqual(stale, ['feature']);
    });
});
