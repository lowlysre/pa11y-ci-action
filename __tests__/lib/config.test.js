import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {findConfigPath, buildSyntheticConfig, parseUrlsInput} from '../../src/lib/config.js';

test('findConfigPath returns the explicit config path when it exists', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));
	const configPath = path.join(dir, 'custom.json');
	fs.writeFileSync(configPath, '{}');

	assert.equal(findConfigPath('custom.json', dir), configPath);
});

test('findConfigPath throws when the explicit config path does not exist', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));

	assert.throws(() => findConfigPath('missing.json', dir), /no file exists/);
});

test('findConfigPath falls back to .pa11yci in the working directory', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));
	fs.writeFileSync(path.join(dir, '.pa11yci'), '{}');

	assert.equal(findConfigPath('', dir), path.join(dir, '.pa11yci'));
});

test('findConfigPath returns null when nothing is found', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));

	assert.equal(findConfigPath('', dir), null);
});

test('buildSyntheticConfig builds a config from urls', () => {
	const config = buildSyntheticConfig({urls: ['https://example.com'], sitemap: undefined, standard: 'WCAG2AA', concurrency: 1});

	assert.deepEqual(config, {
		defaults: {standard: 'WCAG2AA', concurrency: 1, chromeLaunchConfig: {args: ['--no-sandbox']}},
		urls: ['https://example.com']
	});
});

test('buildSyntheticConfig leaves the sitemap out of the config', () => {
	const config = buildSyntheticConfig({urls: [], sitemap: 'https://example.com/sitemap.xml', standard: 'WCAG2AA', concurrency: 1});

	assert.equal(config.sitemap, undefined);
	assert.deepEqual(config.urls, []);
});

test('buildSyntheticConfig throws when there are no urls or sitemap', () => {
	assert.throws(
		() => buildSyntheticConfig({urls: [], sitemap: undefined, standard: 'WCAG2AA', concurrency: 1}),
		/neither `urls` nor `sitemap`/
	);
});

test('parseUrlsInput splits on newlines and drops blank lines', () => {
	assert.deepEqual(
		parseUrlsInput('https://example.com\n\n  https://example.com/about  \n'),
		['https://example.com', 'https://example.com/about']
	);
});

test('parseUrlsInput returns an empty array for an empty input', () => {
	assert.deepEqual(parseUrlsInput(''), []);
});
