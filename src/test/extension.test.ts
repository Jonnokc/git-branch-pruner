import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('registers all commands', async () => {
		await vscode.extensions.getExtension('jonnokc.git-branch-pruner-helper')?.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const id of ['showMenu', 'pruneStale', 'pruneStaleActiveRepo', 'showPruneableStatus']) {
			assert.ok(commands.includes(`gitBranchPruner.${id}`), `missing gitBranchPruner.${id}`);
		}
	});
});
