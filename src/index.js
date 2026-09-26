import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {findConfigPath, buildSyntheticConfig, parseUrlsInput, parseIntegerInput} from './lib/config.js';
import {runPa11yCi} from './lib/runPa11yCi.js';
import {summarize, buildMarkdown, failureMessage, commentMarker, COMMENT_MAX_BYTES, SUMMARY_MAX_BYTES} from './lib/report.js';
import {upsertComment, permissionWarning} from './lib/comment.js';

async function run() {
	const workingDirectory = path.resolve(core.getInput('working-directory') || '.');
	const threshold = parseIntegerInput('threshold', core.getInput('threshold') || '0', {min: 0});
	const commentOnPr = core.getBooleanInput('comment-on-pr');

	const configPath = findConfigPath(core.getInput('config'), workingDirectory);
	const sitemap = core.getInput('sitemap') || undefined;
	const syntheticConfig = configPath ? null : buildSyntheticConfig({
		urls: parseUrlsInput(core.getInput('urls')),
		sitemap,
		standard: core.getInput('standard') || 'WCAG2AA',
		concurrency: parseIntegerInput('concurrency', core.getInput('concurrency') || '1', {min: 1})
	});

	core.info(configPath ?
		`using pa11y-ci config at ${configPath}` :
		'no pa11y-ci config found, using urls/sitemap/standard/concurrency inputs');

	const report = await runPa11yCi({cwd: workingDirectory, configPath, config: syntheticConfig, sitemap});
	const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-report-')), 'report.json');
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
	core.setOutput('report-json', reportPath);
	const summary = summarize(report, threshold);

	core.setOutput('total-urls', summary.totalUrls);
	core.setOutput('passed-urls', summary.passedUrls);
	core.setOutput('total-issues', summary.totalIssues);
	core.setOutput('passed', summary.passed);

	await core.summary.addRaw(buildMarkdown(summary, {maxBytes: SUMMARY_MAX_BYTES})).write();

	if (commentOnPr) {
		const identity = core.getInput('comment-id') || JSON.stringify([github.context.workflow, github.context.job, process.env.GITHUB_ACTION]);
		const marker = commentMarker(identity);
		const {owner, repo} = github.context.repo;
		const runUrl = `${github.context.serverUrl}/${owner}/${repo}/actions/runs/${github.context.runId}`;
		await commentOnPullRequest(buildMarkdown(summary, {maxBytes: COMMENT_MAX_BYTES, marker, runUrl}), marker);
	}

	if (!summary.passed) {
		core.setFailed(failureMessage(summary, threshold));
	}
}

async function commentOnPullRequest(body, marker) {
	if (!github.context.payload.pull_request) {
		core.warning('comment-on-pr is true, but this run was not triggered by a pull_request event; skipping comment');
		return;
	}
	const {owner, repo, number} = github.context.issue;
	try {
		await upsertComment(github.getOctokit(core.getInput('github-token')), {owner, repo, issueNumber: number, body, marker});
	} catch (error) {
		const warning = permissionWarning(error);
		if (!warning) {
			throw error;
		}
		core.warning(warning);
	}
}

run().catch(error => {
	core.setFailed(error.message);
});
