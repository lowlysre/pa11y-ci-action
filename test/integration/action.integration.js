import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {execute} from '../helpers/execute.js';

const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-integration-'));
after(() => fs.rmSync(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}));
const defaults = {chromeLaunchConfig: {args: ['--no-sandbox']}, concurrency: 1};
const passing = pathToFileURL(path.join(root, 'test/fixtures/passing.html')).href;
const failing = pathToFileURL(path.join(root, 'test/fixtures/failing.html')).href;

async function run(name, config, inputs = {}) {
	const configPath = path.join(directory, `${name}.json`);
	if (config) {
		fs.writeFileSync(configPath, JSON.stringify(config));
	}
	const outputPath = path.join(directory, `${name}-outputs.txt`);
	const summaryPath = path.join(directory, `${name}-summary.txt`);
	fs.writeFileSync(outputPath, '');
	fs.writeFileSync(summaryPath, '');
	const result = await execute(path.join(root, 'dist', 'index.mjs'), {name, env: {
		...process.env, TEMP: directory, TMP: directory, TMPDIR: directory,
		INPUT_CONFIG: config ? configPath : '', INPUT_URLS: '', INPUT_SITEMAP: '', INPUT_THRESHOLD: '0',
		'INPUT_COMMENT-ON-PR': 'false', 'INPUT_WORKING-DIRECTORY': directory,
		GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, ...inputs
	}});
	const outputs = {};
	for (const match of fs.readFileSync(outputPath, 'utf8').matchAll(/([a-z-]+)<<([^\r\n]+)\r?\n([\s\S]*?)\r?\n\2/g)) {
		outputs[match[1]] = match[3];
	}
	return {...result, outputs, summary: fs.readFileSync(summaryPath, 'utf8')};
}

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
		assert.equal(allowed.outputs.passed, 'true');
		assert.equal(allowed.outputs['total-issues'], result.outputs['total-issues']);
		assert.ok(fs.existsSync(allowed.outputs['report-json']));
		assert.equal(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'), JSON.stringify(config));
	}
});

test('the bundle rejects empty scans but retains their raw report', async () => {
	const result = await run('empty', {defaults, urls: []});
	assert.equal(result.code, 1);
	assert.match(result.stdout, /tested no URLs/);
	assert.ok(fs.existsSync(result.outputs['report-json']));
});

test('the bundle suppresses caller reporters', async () => {
	const reporter = await run('reporter', {defaults: {...defaults, reporters: ['json']}, urls: [passing]},
		{INPUT_CONCURRENCY: 'unused-with-config'});
	assert.equal(reporter.code, 0, reporter.stdout + reporter.stderr);
	assert.equal(reporter.outputs.passed, 'true');
});

test('the bundle selects the exact JSON file instead of a higher-priority CJS sibling', async () => {
	fs.writeFileSync(path.join(directory, 'exact-json.cjs'), `module.exports = ${JSON.stringify({defaults, urls: [passing]})};`);
	const exact = await run('exact-json', {defaults, urls: [failing]}, {
		INPUT_CONFIG: path.join(directory, 'exact-json.json')
	});
	assert.equal(exact.code, 1);
	assert.ok(Number(exact.outputs['total-issues']) > 0);
});

test('the bundle selects the exact CJS file instead of a higher-priority extensionless sibling', async () => {
	fs.writeFileSync(path.join(directory, 'exact-cjs'), JSON.stringify({defaults, urls: [passing]}));
	const configPath = path.join(directory, 'exact-cjs.cjs');
	fs.writeFileSync(configPath, `module.exports = ${JSON.stringify({defaults, urls: [failing]})};`);
	const exact = await run('exact-cjs', null, {INPUT_CONFIG: configPath});
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
