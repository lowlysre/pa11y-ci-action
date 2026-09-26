import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installPa11yCi} from '../../src/lib/install.js';

test('installPa11yCi uses a fresh production dependency manifest for every invocation', async t => {
	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-install-test-'));
	t.after(() => fs.rmSync(tempDirectory, {recursive: true, force: true}));
	const directories = [];
	const execute = async (command, args, {cwd}) => {
		assert.equal(command, 'npm');
		assert.ok(args.includes('--omit=dev'));
		assert.ok(args.includes('--ignore-scripts=false'));
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'))), {
			private: true, dependencies: {'pa11y-ci': '4.1.1'}
		});
		directories.push(cwd);
		const binDirectory = path.join(cwd, 'node_modules', 'pa11y-ci', 'bin');
		fs.mkdirSync(binDirectory, {recursive: true});
		fs.writeFileSync(path.join(binDirectory, 'pa11y-ci.js'), '');
	};
	for (let index = 0; index < 2; index++) {
		const binary = await installPa11yCi('4.1.1', {tempDirectory, execute});
		assert.ok(fs.existsSync(binary));
	}
	assert.notEqual(directories[0], directories[1]);
});

test('installPa11yCi rejects unsupported Node versions before installing', async () => {
	await assert.rejects(installPa11yCi('4.1.1', {nodeVersion: '20.19.0'}), /requires Node.js 22/);
	await assert.rejects(installPa11yCi(''), /must not be empty/);
});

test('installPa11yCi propagates installation failures', async t => {
	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-install-test-'));
	t.after(() => fs.rmSync(tempDirectory, {recursive: true, force: true}));
	await assert.rejects(installPa11yCi('4.1.1', {
		tempDirectory,
		execute: async () => { throw new Error('npm failed'); }
	}), /npm failed/);
});
