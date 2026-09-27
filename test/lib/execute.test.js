import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {execute, spawnCommand} from '../helpers/execute.js';

function harness() {
	let callback;
	const events = [];
	const child = {
		pid: 12345, exitCode: null, signalCode: null,
		stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
		unref() { events.push('unref'); }
	};
	const dependencies = {
		start(command, args, options, done) {
			callback = done;
			return child;
		},
		async stop() { events.push('stop'); },
		log(message) { events.push(message); }
	};
	return {child, events, dependencies, complete: (...args) => callback(...args)};
}

const options = {env: {}, name: 'fixture', timeout: 20};

test('execute preserves successful and numeric failure results with scenario timings', async () => {
	for (const code of [0, 1, 2]) {
		const h = harness();
		const result = execute('fixture.js', {...options, timeout: 1000}, h.dependencies);
		const stdout = 'x'.repeat(5000);
		h.complete(code ? Object.assign(new Error('failed'), {code}) : null, stdout, 'stderr');
		assert.deepEqual(await result, {code, stdout, stderr: 'stderr'});
		assert.equal(h.events[0], '[integration:fixture] start');
		assert.match(h.events[1], new RegExp(`finish elapsed=\\d+ms exit=${code}`));
		assert.equal(h.events.includes('stop'), false);
	}
});

test('execute rejects spawn failures without waiting for a timeout', async () => {
	const h = harness();
	const result = execute('fixture.js', options, h.dependencies);
	const error = Object.assign(new Error('missing executable'), {code: 'ENOENT'});
	h.complete(error, '', 'spawn failed');
	await assert.rejects(result, value => value === error);
});

test('execute rejects on timeout without waiting for a stalled callback', {timeout: 2000}, async () => {
	const h = harness();
	const started = Date.now();
	const result = execute('fixture.js', options, h.dependencies);
	h.child.stdout.write('x'.repeat(5000) + 'stdout-tail');
	h.child.stderr.write('y'.repeat(5000) + 'stderr-tail');
	await assert.rejects(result, error => {
		assert.match(error.message, /fixture: fixture.js timed out after 20ms \(pid=12345\)/);
		assert.equal(error.stdout.length, 4000);
		assert.equal(error.stderr.length, 4000);
		assert.ok(error.stdout.endsWith('stdout-tail'));
		assert.ok(error.stderr.endsWith('stderr-tail'));
		return true;
	});
	assert.ok(Date.now() - started < 200);
	// The callback never fired, so cleanup runs asynchronously after the reject; give it a tick.
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(h.events.includes('stop'));
	assert.equal(h.child.stdin.destroyed, true);
	assert.ok(h.events.includes('unref'));
	// A late callback after timeout must not resolve/reject or log a second finish line.
	h.complete(null, 'late callback', '');
	assert.equal(h.events.filter(event => event.includes('finish elapsed=')).length, 0);
});

test('execute logs, but does not throw, when cleanup fails after a timeout', {timeout: 2000}, async () => {
	const h = harness();
	h.dependencies.stop = async () => { throw new Error('permission denied'); };
	await assert.rejects(execute('fixture.js', options, h.dependencies), /timed out/);
	await new Promise(resolve => setImmediate(resolve));
	assert.ok(h.events.some(event => event.includes('cleanup failed: permission denied')));
});

test('execute terminates a real subprocess that outlives its timeout', {timeout: 10_000}, async t => {
	let child;
	t.after(() => {
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
	});
	await assert.rejects(execute('fixture.js', {...options, timeout: 500}, {
		start(command, args, options, callback) {
			child = spawnCommand(command, ['-e', 'console.log("ready"); setInterval(() => {}, 1000);'], options, callback);
			return child;
		}
	}), error => {
		assert.match(error.message, /timed out after 500ms/);
		assert.match(error.stdout, /ready/);
		return true;
	});
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.ok(child.exitCode !== null || child.signalCode !== null);
});
