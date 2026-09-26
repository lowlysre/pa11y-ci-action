import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {runPa11yCi} from '../../src/lib/runPa11yCi.js';

const binPath = '/fake/pa11y-ci.js';

function fakeExec({exitCode = 0, stdout = '', stderr = ''} = {}) {
	const calls = [];
	const execFn = async (command, args, options) => {
		calls.push({command, args, options});
		if (stdout) {
			options.listeners.stdout(Buffer.from(stdout));
		}
		if (stderr) {
			options.listeners.stderr(Buffer.from(stderr));
		}
		return exitCode;
	};
	return {execFn, calls};
}

function tmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));
}

const report = {total: 1, passes: 1, errors: 0, results: {'https://example.com': []}};

test('runPa11yCi parses the report on exit code 0', async () => {
	const {execFn} = fakeExec({stdout: JSON.stringify(report)});

	assert.deepEqual(await runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {execFn, binPath}), report);
});

test('runPa11yCi treats exit code 2 as a run with issues, not a crash', async () => {
	const {execFn} = fakeExec({exitCode: 2, stdout: JSON.stringify(report)});

	assert.deepEqual(await runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {execFn, binPath}), report);
});

test('runPa11yCi throws with stderr on any other exit code', async () => {
	const {execFn} = fakeExec({exitCode: 1, stderr: 'no browser'});

	await assert.rejects(
		runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {execFn, binPath}),
		/exited with code 1:\nno browser/
	);
});

test('runPa11yCi bounds the output included in errors', async () => {
	const {execFn} = fakeExec({exitCode: 1, stderr: `${'x'.repeat(10_000)}END`});

	await assert.rejects(
		runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {execFn, binPath}),
		error => error.message.length < 4100 && error.message.endsWith('END')
	);
});

test('runPa11yCi throws a parse error for malformed or missing JSON', async () => {
	for (const stdout of ['not json', '']) {
		const {execFn} = fakeExec({stdout});
		await assert.rejects(
			runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {execFn, binPath}),
			/could not parse pa11y-ci JSON output/
		);
	}
});

test('runPa11yCi runs silently and passes arguments as an array', async () => {
	const {execFn, calls} = fakeExec({stdout: JSON.stringify(report)});
	const sitemap = 'https://example.com/sitemap.xml; rm -rf /';

	await runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json', sitemap}, {execFn, binPath});

	const [{args, options}] = calls;
	assert.equal(options.silent, true);
	assert.equal(options.ignoreReturnCode, true);
	assert.deepEqual(args, [binPath, '--json', '--config', '/cfg.json', '--sitemap', sitemap]);
});

test('runPa11yCi writes a synthetic config when no config path is given', async () => {
	const {execFn, calls} = fakeExec({stdout: JSON.stringify(report)});
	const config = {defaults: {standard: 'WCAG2AA'}, urls: ['https://example.com']};

	await runPa11yCi({cwd: tmpDir(), configPath: null, config}, {execFn, binPath});

	const configArg = calls[0].args[calls[0].args.indexOf('--config') + 1];
	assert.deepEqual(JSON.parse(fs.readFileSync(configArg, 'utf8')), config);
});
