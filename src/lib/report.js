export const MARKER = '<!-- pa11y-ci-action-summary -->';

// GitHub rejects comment bodies over 65,536 characters. Measuring UTF-8
// bytes instead is stricter, so a body that fits in bytes always fits.
export const COMMENT_MAX_BYTES = 65_536;
// GitHub caps each step's job summary at 1 MiB.
export const SUMMARY_MAX_BYTES = 1024 * 1024;

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
			return {url, crashed: true, message: issues[0].message};
		}
		const counts = {error: 0, warning: 0, notice: 0};
		for (const {type} of issues) {
			counts[type] = (counts[type] ?? 0) + 1;
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
 * Make untrusted text (URLs, page-load errors) safe to drop into a
 * markdown table cell: keep it on one line, stop it from adding columns,
 * links, HTML, or formatting, and stop `@name` from pinging anyone.
 */
export function escapeMarkdownCell(text) {
	return String(text)
		.replace(/\r\n|\r|\n/g, ' ')
		.replace(/&/g, '&amp;')
		.replace(/[\\`*_[\]<>|~]/g, '\\$&')
		.replace(/@/g, '@\u200B');
}

const MAX_ERROR_MESSAGE = 500;

function row(url) {
	const name = escapeMarkdownCell(url.url);
	if (url.crashed) {
		const message = url.message.length > MAX_ERROR_MESSAGE ? `${url.message.slice(0, MAX_ERROR_MESSAGE)}…` : url.message;
		return `| ${name} | :warning: failed to load: ${escapeMarkdownCell(message)} | | |`;
	}
	return `| ${name} | ${url.counts.error} | ${url.counts.warning} | ${url.counts.notice} |`;
}

// Load failures first, then URLs with issues, then clean ones, so a
// truncated table still shows what needs fixing.
function rank(url) {
	if (url.crashed) {
		return 0;
	}
	return url.issues > 0 ? 1 : 2;
}

function omittedNote(count) {
	return `\n\n_${count} more URL(s) not shown to stay within GitHub's size limit. See the \`report-json\` output for the full results._`;
}

/**
 * Build the markdown table shared by the job summary and the PR comment,
 * dropping rows once the result would exceed `maxBytes`.
 */
export function buildMarkdown(summary, {maxBytes = Number.POSITIVE_INFINITY} = {}) {
	const header = [
		MARKER,
		'### pa11y-ci results',
		'',
		`${summary.passed ? ':white_check_mark:' : ':x:'} **${summary.passedUrls}/${summary.totalUrls}** URLs passed, **${summary.totalIssues}** issue(s) found`,
		'',
		'| URL | Errors | Warnings | Notices |',
		'| --- | --- | --- | --- |'
	].join('\n');
	const rows = summary.urls.toSorted((a, b) => rank(a) - rank(b)).map(row);

	const full = [header, ...rows].join('\n');
	if (Buffer.byteLength(full) <= maxBytes) {
		return full;
	}

	// Reserve room for the note at its longest, so adding it never overflows.
	const budget = maxBytes - Buffer.byteLength(omittedNote(rows.length));
	let bytes = Buffer.byteLength(header);
	const shown = rows.findIndex(line => (bytes += Buffer.byteLength(line) + 1) > budget);
	return [header, ...rows.slice(0, shown)].join('\n') + omittedNote(rows.length - shown);
}