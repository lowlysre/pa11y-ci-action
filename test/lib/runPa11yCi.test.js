import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {runPa11yCi} from '../../src/lib/runPa11yCi.js';

const binPath = '/fake/pa11y-ci.js';

function fakeExec({exitCode = 0, stdout = '', stderr = ''} = {}) {
	const calls = [];
	const getExecOutput = async (command, args, options) => {
		const configSource = fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8');
		calls.push({command, args, options, configSource});
		return {exitCode, stdout, stderr};
	};
	return {getExecOutput, calls};
}

function tmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));
}

const report = {total: 1, passes: 1, errors: 0, results: {'https://example.com': []}};

test('runPa11yCi parses the report on exit code 0', async () => {
	const {getExecOutput} = fakeExec({stdout: JSON.stringify(report)});

	assert.deepEqual(await runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {getExecOutput, binPath}), report);
});

test('runPa11yCi treats exit code 2 as a run with issues, not a crash', async () => {
	const {getExecOutput} = fakeExec({exitCode: 2, stdout: JSON.stringify(report)});

	assert.deepEqual(await runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {getExecOutput, binPath}), report);
});

test('runPa11yCi throws with stderr on any other exit code', async () => {
	const {getExecOutput} = fakeExec({exitCode: 1, stderr: 'no browser'});

	await assert.rejects(
		runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {getExecOutput, binPath}),
		/exited with code 1:\nno browser/
	);
});

test('runPa11yCi bounds the output included in errors', async () => {
	const {getExecOutput} = fakeExec({exitCode: 1, stderr: `${'x'.repeat(10_000)}END`});

	await assert.rejects(
		runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {getExecOutput, binPath}),
		error => error.message.length < 4100 && error.message.endsWith('END')
	);
});

test('runPa11yCi throws a parse error for malformed or missing JSON', async () => {
	for (const stdout of ['not json', '']) {
		const {getExecOutput} = fakeExec({stdout});
		await assert.rejects(
			runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json'}, {getExecOutput, binPath}),
			/could not parse pa11y-ci JSON output/
		);
	}
});

test('runPa11yCi runs silently and passes arguments as an array', async () => {
	const {getExecOutput, calls} = fakeExec({stdout: JSON.stringify(report)});
	const sitemap = 'https://example.com/sitemap.xml; rm -rf /';

	await runPa11yCi({cwd: tmpDir(), configPath: '/cfg.json', sitemap}, {getExecOutput, binPath});

	const [{args, options}] = calls;
	assert.equal(options.silent, true);
	assert.equal(options.ignoreReturnCode, true);
	assert.deepEqual(args.slice(0, 3), [binPath, '--json', '--config']);
	assert.deepEqual(args.slice(4), ['--sitemap', sitemap]);
	assert.match(calls[0].configSource, /"configPath":"\/cfg.json"/);
	assert.equal(fs.existsSync(args[3]), false);
});

test('runPa11yCi writes a synthetic config when no config path is given', async () => {
	const {getExecOutput, calls} = fakeExec({stdout: JSON.stringify(report)});
	const config = {defaults: {standard: 'WCAG2AA'}, urls: ['https://example.com']};

	await runPa11yCi({cwd: tmpDir(), configPath: null, config}, {getExecOutput, binPath});

	assert.ok(calls[0].configSource.includes(JSON.stringify(config)));
	assert.equal(fs.existsSync(calls[0].args[3]), false);
});

test('runPa11yCi removes its config when the subprocess fails', async () => {
	const {getExecOutput, calls} = fakeExec({exitCode: 1, stderr: 'bad config'});
	await assert.rejects(runPa11yCi({cwd: tmpDir(), config: {}}, {getExecOutput, binPath}), /bad config/);
	assert.equal(fs.existsSync(path.dirname(calls[0].args[3])), false);
});

test('runPa11yCi surfaces bounded config warnings without polluting the JSON report', async () => {
	const {getExecOutput} = fakeExec({stdout: JSON.stringify(report), stderr: `${'x'.repeat(5000)}config threshold overridden\n`});
	const warnings = [];
	assert.deepEqual(await runPa11yCi({cwd: tmpDir(), config: {}}, {
		getExecOutput, binPath, warning: message => warnings.push(message)
	}), report);
	assert.equal(warnings.length, 1);
	assert.ok(warnings[0].length <= 4001);
	assert.ok(warnings[0].endsWith('config threshold overridden'));
});
