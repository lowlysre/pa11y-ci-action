import {test} from 'node:test';
import assert from 'node:assert/strict';
import {permissionWarning} from '../../src/lib/comment.js';

test('permissionWarning explains a 403 as a missing pull-requests: write permission', () => {
	assert.match(permissionWarning({status: 403}), /pull-requests: write/);
});

test('permissionWarning returns null for other errors', () => {
	assert.equal(permissionWarning({status: 500}), null);
	assert.equal(permissionWarning(new Error('network down')), null);
});
