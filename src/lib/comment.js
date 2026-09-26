import {MARKER} from './report.js';

function isRateLimited(error) {
	return error?.response?.headers?.['x-ratelimit-remaining'] === '0' || /rate limit/i.test(error?.message ?? '');
}

/**
 * Return a warning for a comment API error caused by missing token
 * permissions, or `null` if the error is something else. GitHub doesn't
 * expose a token's permissions up front, so a 403 is the only signal.
 * Rate limits also return 403, so those are left to fail the run.
 */
export function permissionWarning(error) {
	if (error?.status !== 403 || isRateLimited(error)) {
		return null;
	}
	const detail = error.message ? ` (GitHub said: ${error.message})` : '';
	return `Skipped the PR comment: GitHub returned 403${detail}. The token most likely lacks \`pull-requests: write\`. `
		+ 'Add it to the job\'s `permissions`. Pull requests from forks get a read-only token and can\'t be commented on.';
}

/**
 * Find the login the token acts as, so the action only ever updates its
 * own comment. PATs answer the REST call; app and `GITHUB_TOKEN`
 * installation tokens don't, so fall back to GraphQL, then to the
 * default Actions bot. Installation tokens always act as a bot, whose
 * REST login carries a `[bot]` suffix GraphQL may leave off.
 */
export async function resolveTokenLogin(octokit) {
	const restLogin = await octokit.rest.users.getAuthenticated().then(({data}) => data.login, () => null);
	if (restLogin) {
		return restLogin;
	}
	const appLogin = await octokit.graphql('query { viewer { login } }').then(({viewer}) => viewer.login, () => null);
	if (appLogin) {
		return appLogin.endsWith('[bot]') ? appLogin : `${appLogin}[bot]`;
	}
	return 'github-actions[bot]';
}

/**
 * Create or update the sticky pa11y-ci summary comment on a pull request.
 * Sticky via the `MARKER` HTML comment embedded in the body, so re-runs
 * update the same comment instead of piling up new ones. Only comments
 * the token itself wrote count, so nobody else can hijack the marker.
 */
export async function upsertComment(octokit, {owner, repo, issueNumber, body, marker = MARKER}) {
	const login = await resolveTokenLogin(octokit);
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {owner, repo, issue_number: issueNumber});
	const existing = comments.find(comment => comment.body?.includes(marker) && comment.user?.login === login);

	if (existing) {
		await octokit.rest.issues.updateComment({owner, repo, comment_id: existing.id, body});
	} else {
		await octokit.rest.issues.createComment({owner, repo, issue_number: issueNumber, body});
	}
}
