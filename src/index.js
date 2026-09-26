import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {findConfigPath, buildSyntheticConfig, parseUrlsInput} from './lib/config.js';
import {runPa11yCi} from './lib/runPa11yCi.js';
import {summarize, buildMarkdown} from './lib/report.js';
import {upsertComment} from './lib/comment.js';

async function run() {
	const workingDirectory = path.resolve(core.getInput('working-directory') || '.');
	const threshold = parseInt(core.getInput('threshold') || '0', 10);
	const commentOnPr = core.getBooleanInput('comment-on-pr');

	const configPath = findConfigPath(core.getInput('config'), workingDirectory);
	const sitemap = configPath ? undefined : core.getInput('sitemap') || undefined;
	const syntheticConfig = configPath ? null : buildSyntheticConfig({
		urls: parseUrlsInput(core.getInput('urls')),
		sitemap,
		standard: core.getInput('standard') || 'WCAG2AA',
		concurrency: parseInt(core.getInput('concurrency') || '1', 10)
	});

	core.info(configPath ?
		`using pa11y-ci config at ${configPath}` :
		'no pa11y-ci config found, using urls/sitemap/standard/concurrency inputs');

	const report = await runPa11yCi({cwd: workingDirectory, configPath, config: syntheticConfig, sitemap, threshold});
	const summary = summarize(report, threshold);
	const markdown = buildMarkdown(summary);

	const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-report-')), 'report.json');
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

	core.setOutput('total-urls', summary.totalUrls);
	core.setOutput('passed-urls', summary.passedUrls);
	core.setOutput('total-issues', summary.totalIssues);
	core.setOutput('passed', summary.passed);
	core.setOutput('report-json', reportPath);

	await core.summary.addRaw(markdown).write();

	if (commentOnPr) {
		const pullRequest = github.context.payload.pull_request;
		if (!pullRequest) {
			core.warning('comment-on-pr is true, but this run was not triggered by a pull_request event; skipping comment');
		} else {
			const octokit = github.getOctokit(core.getInput('github-token'));
			await upsertComment(octokit, {
				owner: github.context.repo.owner,
				repo: github.context.repo.repo,
				issueNumber: pullRequest.number,
				body: markdown
			});
		}
	}

	if (!summary.passed) {
		core.setFailed(`pa11y-ci found ${summary.totalIssues} issue(s) across ${summary.totalUrls - summary.passedUrls} URL(s), exceeding the threshold of ${threshold}`);
	}
}

run().catch(error => {
	core.setFailed(error.message);
});
