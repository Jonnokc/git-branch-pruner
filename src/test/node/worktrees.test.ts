import * as assert from 'assert';
import * as path from 'path';
import { groupWorktrees, parseWorktreeList, prunableWorktreePaths, repositoryName, WorktreeInfo } from '../../worktrees';

suite('parseWorktreeList', () => {
    const output = [
        'worktree /code/app',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
        'worktree /code/app-wt/feature',
        'HEAD 2222222222222222222222222222222222222222',
        'branch refs/heads/feature/login',
        '',
        'worktree /tmp/claude/agent-1',
        'HEAD 3333333333333333333333333333333333333333',
        'branch refs/heads/agent-1',
        'prunable gitdir file points to non-existent location',
        '',
        'worktree /code/app-wt/detached',
        'HEAD 4444444444444444444444444444444444444444',
        'detached',
        'locked',
        ''
    ].join('\n');

    test('reads path, branch and prunable for each record', () => {
        assert.deepStrictEqual(parseWorktreeList(output), [
            { path: '/code/app', branch: 'main', prunable: false },
            { path: '/code/app-wt/feature', branch: 'feature/login', prunable: false },
            { path: '/tmp/claude/agent-1', branch: 'agent-1', prunable: true },
            { path: '/code/app-wt/detached', branch: '', prunable: false }
        ]);
    });

    test('handles CRLF and a bare prunable line', () => {
        const crlf = 'worktree C:/code/app\r\nbranch refs/heads/main\r\n\r\nworktree C:/old\r\nprunable\r\n';
        assert.deepStrictEqual([...prunableWorktreePaths(crlf)], ['C:/old']);
    });

    test('empty output has no worktrees', () => {
        assert.deepStrictEqual(parseWorktreeList(''), []);
    });
});

suite('repositoryName', () => {
    test('names a repository after the folder holding .git', () => {
        assert.strictEqual(repositoryName(path.join('/code', 'app', '.git')), 'app');
    });

    test('strips .git from a bare repository', () => {
        assert.strictEqual(repositoryName(path.join('/code', 'app.git')), 'app');
    });

    test('uses the module name for a submodule', () => {
        assert.strictEqual(repositoryName(path.join('/code', 'app', '.git', 'modules', 'lib')), 'lib');
    });
});

suite('groupWorktrees', () => {
    const appGit = path.join('/code', 'app', '.git');
    const apiGit = path.join('/code', 'api', '.git');
    const worktree = (p: string, commonDir: string, isMain: boolean): WorktreeInfo => ({ path: p, commonDir, isMain });

    test('folds worktrees sharing a git directory into one repository', () => {
        const linked = [...Array(10).keys()].map(i => worktree(`/wt/agent-${i}`, appGit, false));
        const repositories = groupWorktrees([...linked, worktree('/code/app', appGit, true), worktree('/code/api', apiGit, true)]);

        assert.strictEqual(repositories.length, 2);
        assert.deepStrictEqual(repositories.map(r => r.name), ['app', 'api']);
        assert.strictEqual(repositories[0].worktrees.length, 11);
    });

    test('runs git from the main worktree when it is open', () => {
        const [repository] = groupWorktrees([
            worktree('/wt/agent-1', appGit, false),
            worktree('/code/app', appGit, true),
            worktree('/wt/agent-2', appGit, false)
        ]);
        assert.strictEqual(repository.path, '/code/app');
    });

    test('falls back to the first linked worktree when the main one is not open', () => {
        const [repository] = groupWorktrees([
            worktree('/wt/agent-1', appGit, false),
            worktree('/wt/agent-2', appGit, false)
        ]);
        assert.strictEqual(repository.path, '/wt/agent-1');
        assert.strictEqual(repository.name, 'app');
    });
});
