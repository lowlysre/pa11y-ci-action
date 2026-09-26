import {test} from 'node:test';
import assert from 'node:assert/strict';
import {permissionWarning, resolveTokenLogin, upsertComment} from '../../src/lib/comment.js';
import {MARKER, commentMarker} from '../../src/lib/report.js';

test('permissionWarning explains the required permission and includes GitHub\'s message', () => {
	const warning = permissionWarning({status: 403, message: 'Resource not accessible by integration'});
	assert.match(warning, /pull-requests: write/);
	assert.match(warning, /Resource not accessible by integration/);
});

test('permissionWarning returns null for other errors', () => {
	assert.equal(permissionWarning({status: 500}), null);
	assert.equal(permissionWarning(new Error('network down')), null);
});

test('permissionWarning returns null for a rate-limited 403', () => {
	assert.equal(permissionWarning({status: 403, response: {headers: {'x-ratelimit-remaining': '0'}}}), null);
	assert.equal(permissionWarning({status: 403, message: 'You have exceeded a secondary rate limit'}), null);
});

function fakeOctokit({comments = [], restLogin, graphqlLogin} = {}) {
	const calls = {update: [], create: [], paginate: []};
	const octokit = {
		rest: {
			users: {
				async getAuthenticated() {
					if (!restLogin) {
						throw Object.assign(new Error('Resource not accessible by integration'), {status: 403});
					}
					return {data: {login: restLogin}};
				}
			},
			issues: {
				listComments: Symbol('listComments'),
				async updateComment(params) {
					calls.update.push(params);
				},
				async createComment(params) {
					calls.create.push(params);
				}
			}
		},
		async graphql() {
			if (!graphqlLogin) {
				throw new Error('Resource not accessible by integration');
			}
			return {viewer: {login: graphqlLogin}};
		},
		async paginate(method, params) {
			calls.paginate.push({method, params});
			return comments;
		}
	};
	return {octokit, calls};
}

const target = {owner: 'o', repo: 'r', issueNumber: 7, body: 'new body'};
const bot = {login: 'github-actions[bot]', type: 'Bot'};

test('resolveTokenLogin prefers REST, then GraphQL, then the Actions bot', async () => {
	assert.equal(await resolveTokenLogin(fakeOctokit({restLogin: 'alice', graphqlLogin: 'x'}).octokit), 'alice');
	assert.equal(await resolveTokenLogin(fakeOctokit({graphqlLogin: 'my-app'}).octokit), 'my-app[bot]');
	assert.equal(await resolveTokenLogin(fakeOctokit({graphqlLogin: 'my-app[bot]'}).octokit), 'my-app[bot]');
	assert.equal(await resolveTokenLogin(fakeOctokit().octokit), 'github-actions[bot]');
});

test('upsertComment updates its own marker comment, skipping null and foreign bodies', async () => {
	const {octokit, calls} = fakeOctokit({comments: [
		{id: 1, body: null, user: bot},
		{id: 3, body: `quoting ${MARKER}`, user: {login: 'mallory', type: 'User'}},
		{id: 2, body: `${MARKER}\nold`, user: bot}
	]});

	await upsertComment(octokit, target);

	assert.deepEqual(calls.update, [{owner: 'o', repo: 'r', comment_id: 2, body: 'new body'}]);
	assert.deepEqual(calls.create, []);
});

test('upsertComment creates its own comment when only a foreign one has the marker', async () => {
	const {octokit, calls} = fakeOctokit({comments: [
		{id: 1, body: MARKER, user: {login: 'mallory', type: 'User'}}
	]});

	await upsertComment(octokit, target);

	assert.equal(calls.update.length, 0);
	assert.deepEqual(calls.create, [{owner: 'o', repo: 'r', issue_number: 7, body: 'new body'}]);
	assert.deepEqual(calls.paginate[0].params, {owner: 'o', repo: 'r', issue_number: 7});
});

test('upsertComment matches an app\'s bot comment, not a user sharing its name', async () => {
	const {octokit, calls} = fakeOctokit({
		graphqlLogin: 'my-app',
		comments: [
			{id: 1, body: MARKER, user: {login: 'my-app', type: 'User'}},
			{id: 2, body: MARKER, user: {login: 'my-app[bot]', type: 'Bot'}}
		]
	});

	await upsertComment(octokit, target);

	assert.deepEqual(calls.update.map(call => call.comment_id), [2]);
});

test('upsertComment matches a PAT user\'s own comment', async () => {
	const {octokit, calls} = fakeOctokit({
		restLogin: 'alice',
		comments: [
			{id: 1, body: MARKER, user: bot},
			{id: 2, body: MARKER, user: {login: 'alice', type: 'User'}}
		]
	});

	await upsertComment(octokit, target);

	assert.deepEqual(calls.update.map(call => call.comment_id), [2]);
});

test('upsertComment keeps independent action comments separate', async () => {
	const marker = commentMarker('site-b');
	const {octokit, calls} = fakeOctokit({comments: [
		{id: 1, body: commentMarker('site-a'), user: bot},
		{id: 2, body: marker, user: bot}
	]});
	await upsertComment(octokit, {...target, marker});
	assert.deepEqual(calls.update.map(call => call.comment_id), [2]);
});
