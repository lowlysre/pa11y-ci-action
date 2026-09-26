import {MARKER} from './report.js';

/**
 * Return a warning for a comment API error caused by missing token
 * permissions, or `null` if the error is something else. GitHub doesn't
 * expose a token's permissions up front, so a 403 is the only signal.
 */
export function permissionWarning(error) {
	if (error?.status !== 403) {
		return null;
	}
	return 'Skipped the PR comment: the token lacks `pull-requests: write`. Add it to the job\'s `permissions`. '
		+ 'Pull requests from forks get a read-only token and can\'t be commented on.';
}

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
