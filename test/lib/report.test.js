import test from 'node:test';
import assert from 'node:assert/strict';

import {summarize, buildMarkdown, failureMessage, escapeMarkdownCell, COMMENT_MAX_BYTES} from '../../src/lib/report.js';

function issue(type) {
	return {code: 'WCAG2AA.Test', type, message: `a ${type}`, context: '<div>', selector: 'div'};
}

test('summarize counts passes, issues, and per-url breakdowns', () => {
	const report = {
		total: 2,
		passes: 1,
		errors: 2,
		results: {
			'https://example.com/ok': [],
			'https://example.com/bad': [issue('error'), issue('warning')]
		}
	};

	const summary = summarize(report, 0);

	assert.equal(summary.totalUrls, 2);
	assert.equal(summary.passedUrls, 1);
	assert.equal(summary.totalIssues, 2);
	assert.equal(summary.passed, false);
	assert.deepEqual(
		summary.urls.find(url => url.url === 'https://example.com/bad').counts,
		{error: 1, warning: 1, notice: 0}
	);
});

test('summarize passes when issues are within threshold and all urls resolved', () => {
	const report = {
		total: 1,
		passes: 1,
		errors: 3,
		results: {
			'https://example.com': [issue('notice'), issue('notice'), issue('notice')]
		}
	};

	const summary = summarize(report, 3);

	assert.equal(summary.passed, true);
});

test('summarize flags a page-load failure as crashed instead of an issue', () => {
	const report = {
		total: 1,
		passes: 0,
		errors: 0,
		results: {
			'https://example.com/down': [{message: 'net::ERR_CONNECTION_REFUSED'}]
		}
	};

	const summary = summarize(report, 0);
	const url = summary.urls[0];

	assert.equal(url.crashed, true);
	assert.equal(url.message, 'net::ERR_CONNECTION_REFUSED');
	assert.equal(summary.crashedUrls, 1);
	assert.equal(summary.totalIssues, 0);
	assert.equal(summary.passed, false);
});

test('summarize counts issues from results, not pa11y-ci passes/errors', () => {
	const report = {
		total: 2,
		passes: 2,
		errors: 0,
		results: {
			'https://example.com/a': [issue('error'), issue('error')],
			'https://example.com/b': [issue('notice')]
		}
	};

	const summary = summarize(report, 5);

	assert.equal(summary.passedUrls, 0);
	assert.equal(summary.totalIssues, 3);
	assert.equal(summary.passed, true);
});

test('failureMessage returns null for a passing run', () => {
	assert.equal(failureMessage({crashedUrls: 0, totalIssues: 2}, 2), null);
});

test('failureMessage reports load failures without blaming the threshold', () => {
	assert.equal(failureMessage({crashedUrls: 1, totalIssues: 0}, 0), 'pa11y-ci 1 URL(s) failed to load');
});

test('failureMessage reports both load failures and threshold breaches', () => {
	assert.equal(
		failureMessage({crashedUrls: 2, totalIssues: 4}, 1),
		'pa11y-ci 2 URL(s) failed to load and found 4 issue(s), exceeding the threshold of 1'
	);
});

test('buildMarkdown includes the sticky marker and a row per url', () => {
	const summary = summarize({
		total: 1,
		passes: 1,
		errors: 0,
		results: {'https://example.com': []}
	}, 0);

	const markdown = buildMarkdown(summary);

	assert.match(markdown, /pa11y-ci-action-summary/);
	assert.match(markdown, /https:\/\/example\.com/);
	assert.match(markdown, /1\/1.*URLs passed/);
});

test('escapeMarkdownCell keeps untrusted text on one line and inert', () => {
	const escaped = escapeMarkdownCell('a|b\r\nc\nd `x` <img> [l](u) *b* _i_ ~s~ \\ & @octocat');

	assert.equal(escaped.includes('\n'), false);
	assert.equal(escaped.includes('\r'), false);
	assert.match(escaped, /a\\\|b c d/);
	assert.match(escaped, /\\`x\\`/);
	assert.match(escaped, /\\<img\\>/);
	assert.match(escaped, /\\\[l\\\]\(u\)/);
	assert.match(escaped, /\\\*b\\\* \\_i\\_ \\~s\\~ \\\\ &amp;/);
	assert.match(escaped, /@\u200Boctocat/);
});

test('buildMarkdown escapes urls and load errors in table rows', () => {
	const summary = summarize({
		total: 2,
		results: {
			'https://example.com/a|b': [],
			'https://example.com/down': [{message: 'boom\n| injected | row |\n@octocat'}]
		}
	}, 0);

	const rows = buildMarkdown(summary).split('\n').filter(line => line.startsWith('| https'));

	assert.equal(rows.length, 2);
	assert.match(rows.join('\n'), /a\\\|b/);
	assert.match(rows.join('\n'), /boom \\\| injected \\\| row \\\| @\u200Boctocat/);
});

test('buildMarkdown lists load failures and issues before clean urls', () => {
	const summary = summarize({
		total: 3,
		results: {
			'https://example.com/clean': [],
			'https://example.com/issues': [issue('error')],
			'https://example.com/down': [{message: 'net::ERR'}]
		}
	}, 0);

	const urls = buildMarkdown(summary).split('\n').filter(line => line.startsWith('| https')).map(line => line.split(' ')[1]);

	assert.deepEqual(urls, ['https://example.com/down', 'https://example.com/issues', 'https://example.com/clean']);
});

function bigSummary(count, suffix = '') {
	const results = {};
	for (let index = 0; index < count; index++) {
		results[`https://example.com/page-${index}${suffix}`] = [issue('error')];
	}
	return summarize({total: count, results}, 0);
}

test('buildMarkdown leaves small reports untouched by the size limit', () => {
	const summary = bigSummary(3);

	assert.equal(buildMarkdown(summary, {maxBytes: COMMENT_MAX_BYTES}), buildMarkdown(summary));
});

test('buildMarkdown drops rows and notes the omission when over the limit', () => {
	const summary = bigSummary(2000);
	const markdown = buildMarkdown(summary, {maxBytes: COMMENT_MAX_BYTES});

	assert.ok(Buffer.byteLength(markdown) <= COMMENT_MAX_BYTES);
	const shown = markdown.split('\n').filter(line => line.startsWith('| https')).length;
	assert.ok(shown > 0 && shown < 2000);
	assert.match(markdown, new RegExp(`_${2000 - shown} more URL\\(s\\) not shown`));
	assert.match(markdown, /report-json/);
});

test('buildMarkdown measures the limit in bytes for multibyte text', () => {
	const summary = bigSummary(2000, '/日本語ページ');
	const markdown = buildMarkdown(summary, {maxBytes: COMMENT_MAX_BYTES});

	assert.ok(Buffer.byteLength(markdown) <= COMMENT_MAX_BYTES);
	assert.match(markdown, /more URL\(s\) not shown/);
});

test('buildMarkdown fits exactly at the boundary without an omission note', () => {
	const summary = bigSummary(5);
	const full = buildMarkdown(summary);
	const size = Buffer.byteLength(full);

	assert.equal(buildMarkdown(summary, {maxBytes: size}), full);
	assert.match(buildMarkdown(summary, {maxBytes: size - 1}), /more URL\(s\) not shown/);
	assert.ok(Buffer.byteLength(buildMarkdown(summary, {maxBytes: size - 1})) <= size - 1);
});
