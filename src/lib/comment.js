import {MARKER} from './report.js';

/**
 * Create or update the sticky pa11y-ci summary comment on a pull request.
 * Sticky via the `MARKER` HTML comment embedded in the body, so re-runs
 * update the same comment instead of piling up new ones.
 */
export async function upsertComment(octokit, {owner, repo, issueNumber, body}) {
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		owner,
		repo,
		issue_number: issueNumber
	});
	const existing = comments.find(comment => comment.body.includes(MARKER));

	if (existing) {
		await octokit.rest.issues.updateComment({
			owner,
			repo,
			comment_id: existing.id,
			body
		});
		return;
	}

	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: issueNumber,
		body
	});
}
