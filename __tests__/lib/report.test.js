import test from 'node:test';
import assert from 'node:assert/strict';

import {summarize, buildMarkdown} from '../../src/lib/report.js';

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
