export const MARKER = '<!-- pa11y-ci-action-summary -->';

/**
 * Reduce a raw pa11y-ci report ({total, passes, errors, results}) into
 * the counts the action exposes as outputs, plus a per-URL breakdown by
 * issue type for the summary table.
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
		return {url, crashed: false, counts};
	});

	return {
		totalUrls: report.total,
		passedUrls: report.passes,
		totalIssues: report.errors,
		passed: report.errors <= threshold && report.passes === report.total,
		urls
	};
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
