import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {findConfigPath, buildSyntheticConfig, parseUrlsInput, parseIntegerInput, loadConfig} from '../../src/lib/config.js';

test('findConfigPath throws when the explicit config path does not exist', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));

	assert.throws(() => findConfigPath('missing.json', dir), /no file exists/);
});

test('findConfigPath falls back to .pa11yci in the working directory', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-test-'));
	fs.writeFileSync(path.join(dir, '.pa11yci'), '{}');

	assert.equal(findConfigPath('', dir), path.join(dir, '.pa11yci'));
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

test('parseIntegerInput accepts whole numbers at or above the minimum', () => {
	assert.equal(parseIntegerInput('threshold', '0', {min: 0}), 0);
	assert.equal(parseIntegerInput('threshold', ' 12 ', {min: 0}), 12);
	assert.equal(parseIntegerInput('concurrency', '4', {min: 1}), 4);
});

test('parseIntegerInput rejects junk, decimals, negatives, and unsafe integers', () => {
	for (const value of ['abc', '2x', '1.5', '-1', '', '1e3', '99999999999999999999']) {
		assert.throws(() => parseIntegerInput('threshold', value, {min: 0}), /`threshold` must be a whole number/, value);
	}
});

test('parseIntegerInput rejects values below the minimum', () => {
	assert.throws(() => parseIntegerInput('concurrency', '0', {min: 1}), /at least 1, got "0"/);
});

test('loadConfig overrides thresholds in copies and warns once without mutating shared configs', async () => {
	for (const config of [
		{threshold: 1},
		{defaults: {threshold: 1}},
		{urls: [{url: 'https://example.com', threshold: 1}]},
		{threshold: 2, defaults: {threshold: 3}, urls: [{url: 'https://example.com', threshold: 4}]}
	]) {
		const original = structuredClone(config);
		Object.freeze(config.defaults);
		config.urls?.forEach(Object.freeze);
		Object.freeze(config.urls);
		Object.freeze(config);
		const warnings = [];
		const loaded = await loadConfig({config}, message => warnings.push(message));
		assert.equal(loaded.threshold, 0);
		assert.equal(loaded.defaults.threshold, 0);
		assert.ok(loaded.urls.every(url => typeof url === 'string' || url.threshold === 0));
		assert.deepEqual(config, original);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /original config is unchanged/);
	}
});

test('loadConfig leaves missing or zero thresholds quiet', async () => {
	for (const config of [{}, {threshold: 0, defaults: {threshold: 0}, urls: [{url: 'https://example.com', threshold: 0}]}]) {
		const warnings = [];
		await loadConfig({config}, message => warnings.push(message));
		assert.deepEqual(warnings, []);
	}
});

test('loadConfig supports promised CJS and ESM configs with relative imports', async t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-config-'));
	t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
	fs.writeFileSync(path.join(directory, 'urls.json'), '["https://example.com"]');
	const commonjs = path.join(directory, 'config.cjs');
	fs.writeFileSync(commonjs, 'module.exports = Promise.resolve({urls: require("./urls.json")});');
	assert.deepEqual((await loadConfig({configPath: commonjs})).urls, ['https://example.com']);
	const esm = path.join(directory, 'config.mjs');
	fs.writeFileSync(esm, 'export default {urls: ["https://example.com/esm"]};');
	assert.deepEqual((await loadConfig({configPath: esm})).urls, ['https://example.com/esm']);
});

test('loadConfig rejects invalid config shapes', async () => {
	for (const config of [null, [], {defaults: []}, {urls: 'https://example.com'}, {urls: [null]}, {urls: ['']}]) {
		await assert.rejects(loadConfig({config}), /config/);
	}
});
