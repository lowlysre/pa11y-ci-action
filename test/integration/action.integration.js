import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';

const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-integration-'));
after(() => fs.rmSync(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}));
const defaults = {chromeLaunchConfig: {args: ['--no-sandbox']}, concurrency: 1};
const passing = pathToFileURL(path.join(root, 'test/fixtures/passing.html')).href;
const failing = pathToFileURL(path.join(root, 'test/fixtures/failing.html')).href;

function stopProcessTree(child) {
	if (process.platform !== 'win32') {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch (error) {
			if (error.code !== 'ESRCH') {
				throw error;
			}
		}
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {timeout: 10_000}, (error, stdout, stderr) => {
			if (error && child.exitCode === null && child.signalCode === null) {
				reject(new Error(`could not stop test process tree ${child.pid}: ${stderr || stdout}`, {cause: error}));
				return;
			}
			resolve();
		});
	});
}

function execute(file, env, timeout = 60_000) {
	return new Promise((resolve, reject) => {
		let termination;
		const child = execFile(process.execPath, [path.resolve(root, file)], {
			env, detached: process.platform !== 'win32'
		}, async (error, stdout, stderr) => {
			clearTimeout(timer);
			if (termination) {
				try {
					await termination;
				} catch (terminationError) {
					reject(terminationError);
					return;
				}
				reject(Object.assign(new Error(`${file} timed out after ${timeout}ms\n${stdout.slice(-4000)}\n${stderr.slice(-4000)}`),
					{stdout, stderr}));
				return;
			}
			if (error && typeof error.code !== 'number') {
				reject(error);
				return;
			}
			resolve({code: error?.code ?? 0, stdout, stderr});
		});
		const timer = setTimeout(() => {
			termination = Promise.resolve().then(() => stopProcessTree(child));
			termination.catch(reject);
		}, timeout);
	});
}

async function run(name, config, inputs = {}) {
	const configPath = path.join(directory, `${name}.json`);
	if (config) {
		fs.writeFileSync(configPath, JSON.stringify(config));
	}
	const outputPath = path.join(directory, `${name}-outputs.txt`);
	const summaryPath = path.join(directory, `${name}-summary.txt`);
	fs.writeFileSync(outputPath, '');
	fs.writeFileSync(summaryPath, '');
	const result = await execute('dist/index.mjs', {
		...process.env, TEMP: directory, TMP: directory, TMPDIR: directory,
		INPUT_CONFIG: config ? configPath : '', INPUT_URLS: '', INPUT_SITEMAP: '', INPUT_THRESHOLD: '0',
		'INPUT_COMMENT-ON-PR': 'false', 'INPUT_WORKING-DIRECTORY': directory,
		GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, ...inputs
	});
	const outputs = {};
	for (const match of fs.readFileSync(outputPath, 'utf8').matchAll(/([a-z-]+)<<([^\r\n]+)\r?\n([\s\S]*?)\r?\n\2/g)) {
		outputs[match[1]] = match[3];
	}
	return {...result, outputs, summary: fs.readFileSync(summaryPath, 'utf8')};
}

test('the bundle preserves passing, failing, and action-threshold behavior', async () => {
	const clean = await run('passing', {defaults, urls: [passing]}, {INPUT_CONCURRENCY: 'unused-with-config'});
	assert.equal(clean.code, 0, clean.stdout + clean.stderr);
	assert.equal(clean.outputs.passed, 'true');
	const bad = await run('failing', {defaults, urls: [failing]});
	assert.equal(bad.code, 1);
	assert.ok(Number(bad.outputs['total-issues']) > 0);
	assert.equal(bad.outputs.passed, 'false');
	const allowed = await run('threshold', {defaults, urls: [failing]}, {INPUT_THRESHOLD: bad.outputs['total-issues']});
	assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
	assert.equal(allowed.outputs['total-issues'], bad.outputs['total-issues']);
	assert.ok(fs.existsSync(allowed.outputs['report-json']));
});

test('the bundle rejects duplicate scenarios', async () => {
	const result = await run('duplicate', {defaults, urls: [failing, {url: failing, ignore: ['*']}]});
	assert.equal(result.code, 1);
	assert.match(result.stdout, /duplicate URL/);
	assert.notEqual(result.outputs.passed, 'true');
});

test('the bundle overrides shared config thresholds without changing the source file', async () => {
	for (const [name, config] of [
		['config-threshold', {threshold: 1000, defaults: {...defaults, threshold: 1000}, urls: [failing]}],
		['url-threshold', {defaults, urls: [{url: failing, threshold: 1000}]}]
	]) {
		const result = await run(name, config);
		assert.equal(result.code, 1);
		assert.equal(result.outputs.passed, 'false');
		assert.ok(Number(result.outputs['total-issues']) > 0);
		assert.match(result.stdout, /::warning::Config thresholds are overridden/);
		assert.equal(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'), JSON.stringify(config));
		const allowed = await run(name, config, {INPUT_THRESHOLD: result.outputs['total-issues']});
		assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
		assert.equal(allowed.outputs['total-issues'], result.outputs['total-issues']);
		assert.equal(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'), JSON.stringify(config));
	}
});

test('the bundle rejects empty scans but retains their raw report', async () => {
	const result = await run('empty', {defaults, urls: []});
	assert.equal(result.code, 1);
	assert.match(result.stdout, /tested no URLs/);
	assert.ok(fs.existsSync(result.outputs['report-json']));
});

test('the bundle supports generated configs and promised JavaScript configs', async () => {
	const generated = await run('generated', null, {INPUT_URLS: passing});
	assert.equal(generated.code, 0, generated.stdout + generated.stderr);
	const configPath = path.join(directory, 'promised.cjs');
	fs.writeFileSync(configPath, `module.exports = Promise.resolve(${JSON.stringify({defaults, urls: [passing]})});`);
	const promised = await run('promised', null, {INPUT_CONFIG: configPath});
	assert.equal(promised.code, 0, promised.stdout + promised.stderr);
});

test('the bundle suppresses caller reporters and honors the exact config filename', async () => {
	const reporter = await run('reporter', {defaults: {...defaults, reporters: ['json']}, urls: [passing]});
	assert.equal(reporter.code, 0, reporter.stdout + reporter.stderr);
	fs.writeFileSync(path.join(directory, 'exact.cjs'), `module.exports = ${JSON.stringify({defaults, urls: [passing]})};`);
	const exact = await run('exact', {defaults, urls: [failing]});
	assert.equal(exact.code, 1);
	assert.ok(Number(exact.outputs['total-issues']) > 0);
});

test('the bundle supports a sitemap alongside an existing defaults config', async t => {
	const server = http.createServer((request, response) => {
		if (request.url === '/sitemap.xml') {
			response.setHeader('Content-Type', 'application/xml');
			response.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/passing.html</loc></url></urlset>`);
		} else if (request.url === '/passing.html') {
			response.end(fs.readFileSync(path.join(root, 'test/fixtures/passing.html')));
		} else {
			response.writeHead(404).end('not found');
		}
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	const base = `http://127.0.0.1:${server.address().port}`;
	const result = await run('sitemap', {defaults}, {INPUT_SITEMAP: `${base}/sitemap.xml`});
	assert.equal(result.code, 0, result.stdout + result.stderr);
	assert.equal(result.outputs['total-urls'], '1');
	const missing = await run('missing-sitemap', {defaults}, {INPUT_SITEMAP: `${base}/missing.xml`});
	assert.equal(missing.code, 1);
	assert.match(missing.stdout, /tested no URLs/);
	const duplicate = await run('duplicate-sitemap', {defaults, urls: [`${base}/passing.html`]},
		{INPUT_SITEMAP: `${base}/sitemap.xml`});
	assert.equal(duplicate.code, 1);
	assert.match(duplicate.stdout, /incomplete pa11y-ci report/);
	assert.ok(fs.existsSync(duplicate.outputs['report-json']));
});

test('the bundle fails load errors regardless of the threshold', async () => {
	const result = await run('load-error', {defaults, urls: [pathToFileURL(path.join(directory, 'missing.html')).href]},
		{INPUT_THRESHOLD: '1000'});
	assert.equal(result.code, 1);
	assert.equal(result.outputs.passed, 'false');
	assert.match(result.stdout, /failed to load/);
});

test('the installer bundle installs pa11y-ci under production omission settings', async () => {
	const outputPath = path.join(directory, 'install-outputs.txt');
	fs.writeFileSync(outputPath, '');
	const result = await execute('dist/install.mjs', {
		...process.env, NODE_ENV: 'production', npm_config_omit: 'dev', npm_config_loglevel: 'http',
		PA11Y_CI_VERSION: '4.1.1', PUPPETEER_SKIP_DOWNLOAD: 'true',
		RUNNER_TEMP: directory, GITHUB_OUTPUT: outputPath
	}, 300_000);
	assert.equal(result.code, 0, result.stdout + result.stderr);
	const binary = fs.readFileSync(outputPath, 'utf8').match(/bin-path<<[^\r\n]+\r?\n([^\r\n]+)/)?.[1];
	assert.ok(binary && fs.existsSync(binary));
	const modules = path.resolve(binary, '../../..');
	assert.equal(fs.existsSync(path.join(modules, 'esbuild')), false);
	assert.equal(fs.existsSync(path.join(modules, '@actions/core')), false);
	const isolated = await run('isolated-runtime', {defaults, urls: [passing]}, {PA11Y_CI_BIN: binary});
	assert.equal(isolated.code, 0, isolated.stdout + isolated.stderr);
});

test('a timed-out command stops its descendants before cleanup', async () => {
	let output;
	await assert.rejects(execute('test/fixtures/process-tree.cjs', process.env, 3000), error => {
		assert.match(error.message, /timed out after 3000ms/);
		output = error.stdout;
		return true;
	});
	const port = JSON.parse(output.trim()).port;
	await new Promise((resolve, reject) => {
		const socket = net.connect({host: '127.0.0.1', port});
		socket.once('connect', () => {
			socket.end('stop');
			reject(new Error('descendant survived the test timeout'));
		});
		socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
		socket.setTimeout(5000, () => {
			socket.destroy();
			reject(new Error('descendant cleanup probe timed out'));
		});
	});
});
