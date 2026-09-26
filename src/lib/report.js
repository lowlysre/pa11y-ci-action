export const MARKER = '<!-- pa11y-ci-action-summary -->';

/**
 * Reduce a raw pa11y-ci report into the counts the action exposes as
 * outputs, plus a per-URL breakdown by issue type for the summary table.
 * Counts come from `results`, not pa11y-ci's `passes`/`errors`, which
 * don't count load failures as failures.
 */
export function summarize(report, threshold) {
	const urls = Object.entries(report.results).map(([url, issues]) => {
		if (issues.length === 1 && issues[0].message && !issues[0].code) {
			// pa11y-ci serializes a page-load Error as a single {message} object
			return {url, crashed: true, message: issues[0].message, counts: {error: 0, warning: 0, notice: 0}};
		}
		const counts = {error: 0, warning: 0, notice: 0};
		for (const issue of issues) {
			counts[issue.type] = (counts[issue.type] || 0) + 1;
		}
		return {url, crashed: false, issues: issues.length, counts};
	});

	const loaded = urls.filter(url => !url.crashed);
	const totalIssues = loaded.reduce((sum, url) => sum + url.issues, 0);
	const crashedUrls = urls.length - loaded.length;

	return {
		totalUrls: report.total,
		passedUrls: loaded.filter(url => url.issues === 0).length,
		crashedUrls,
		totalIssues,
		passed: totalIssues <= threshold && crashedUrls === 0,
		urls
	};
}

/**
 * Explain why a run failed, or return `null` if it passed.
 */
export function failureMessage(summary, threshold) {
	const reasons = [];
	if (summary.crashedUrls > 0) {
		reasons.push(`${summary.crashedUrls} URL(s) failed to load`);
	}
	if (summary.totalIssues > threshold) {
		reasons.push(`found ${summary.totalIssues} issue(s), exceeding the threshold of ${threshold}`);
	}
	return reasons.length > 0 ? `pa11y-ci ${reasons.join(' and ')}` : null;
}

/**
 * Build the markdown table shared by the job summary and the PR comment.
 */
export function buildMarkdown(summary) {
	const lines = [
		MARKER,
		`### pa11y-ci results`,
		'',
		`${summary.passed ? ':white_check_mark:' : ':x:'} **${summary.passedUrls}/${summary.totalUrls}** URLs passed, **${summary.totalIssues}** issue(s) found`,
		'',
		'| URL | Errors | Warnings | Notices |',
		'| --- | --- | --- | --- |'
	];

	for (const url of summary.urls) {
		if (url.crashed) {
			lines.push(`| ${url.url} | :warning: failed to load: ${url.message} | | |`);
			continue;
		}
		lines.push(`| ${url.url} | ${url.counts.error} | ${url.counts.warning} | ${url.counts.notice} |`);
	}

	return lines.join('\n');
}
