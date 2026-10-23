import * as assert from 'assert';
import { BranchInfo, isStale, parseBranches } from '../../staleBranches';

const protectedBranches = ['main', 'master', 'develop'];

function branch(overrides: Partial<BranchInfo>): BranchInfo {
    return {
        name: 'feature',
        upstream: 'origin/feature',
        track: '[gone]',
        isHead: false,
        worktreePath: '',
        lastCommitDate: '2 days ago',
        subject: 'Add feature',
        ...overrides
    };
}

suite('parseBranches', () => {
    test('splits NUL-separated fields', () => {
        const output = [
            ['feature', 'origin/feature', '[gone]', ' ', '', '3 days ago', 'Fix: a'].join('\0'),
            ['main', 'origin/main', '', '*', '/repo', 'an hour ago', 'Initial commit'].join('\0'),
            ''
        ].join('\n');

        assert.deepStrictEqual(parseBranches(output), [
            { name: 'feature', upstream: 'origin/feature', track: '[gone]', isHead: false, worktreePath: '', lastCommitDate: '3 days ago', subject: 'Fix: a' },
            { name: 'main', upstream: 'origin/main', track: '', isHead: true, worktreePath: '/repo', lastCommitDate: 'an hour ago', subject: 'Initial commit' }
        ]);
    });

    test('handles CRLF output and empty input', () => {
        assert.strictEqual(parseBranches('').length, 0);
        assert.strictEqual(parseBranches(['a', '', '', ' ', '', 'now', 'x'].join('\0') + '\r\n').length, 1);
    });
});

suite('isStale', () => {
    test('branch whose upstream is gone is stale', () => {
        assert.strictEqual(isStale(branch({}), protectedBranches), true);
    });

    test('branch with a live upstream is not stale', () => {
        assert.strictEqual(isStale(branch({ track: '' }), protectedBranches), false);
        assert.strictEqual(isStale(branch({ track: '[ahead 2]' }), protectedBranches), false);
    });

    test('branch that never had an upstream is not stale', () => {
        assert.strictEqual(isStale(branch({ upstream: '', track: '' }), protectedBranches), false);
    });

    test('protected branches are never stale', () => {
        assert.strictEqual(isStale(branch({ name: 'develop', upstream: 'origin/develop' }), protectedBranches), false);
    });

    test('checked-out branches are never stale', () => {
        assert.strictEqual(isStale(branch({ isHead: true, worktreePath: '/repo' }), protectedBranches), false);
        assert.strictEqual(isStale(branch({ worktreePath: '/repo-wt' }), protectedBranches), false);
    });
});
