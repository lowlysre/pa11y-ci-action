import {execFile, spawn} from 'node:child_process';

const tail = text => text.slice(-4000);

/**
 * execFile() does not forward the `detached` option to the spawn() call it
 * makes internally, so a child launched through it can never be placed in
 * its own process group: `stopProcessTree`'s group kill would silently no-op
 * on POSIX. spawn() honors `detached`; this wraps it with the same
 * (error, stdout, stderr) callback shape execFile gives us.
 */
export function spawnCommand(command, args, options, callback) {
	const child = spawn(command, args, options);
	let stdout = '';
	let stderr = '';
	let settled = false;
	child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
	child.stderr?.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
	child.once('error', error => {
		if (settled) {
			return;
		}
		settled = true;
		callback(error, stdout, stderr);
	});
	child.once('close', (code, signal) => {
		if (settled) {
			return;
		}
		settled = true;
		if (code === 0 && signal === null) {
			callback(null, stdout, stderr);
			return;
		}
		callback(Object.assign(new Error(`${command} exited with code ${code}, signal ${signal}`), {code, signal}), stdout, stderr);
	});
	return child;
}

function releaseHandles(child) {
	child.stdin?.destroy();
	child.stdout?.destroy();
	child.stderr?.destroy();
	child.unref();
}

// Kills the whole process tree, not just the direct child: a detached
// process group on POSIX, or `taskkill /T` on Windows.
function stopProcessTree(child) {
	if (process.platform !== 'win32') {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch (error) {
			if (error.code !== 'ESRCH') {
				throw error;
			}
		}
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {timeout: 10_000}, (error, stdout, stderr) => {
			if (error && child.exitCode === null && child.signalCode === null) {
				reject(new Error(`could not stop test process tree ${child.pid}: ${stderr || stdout}`, {cause: error}));
				return;
			}
			resolve();
		});
	});
}

/**
 * Run a bundled entry point in a subprocess and reject on timeout without
 * waiting for its close callback: a descendant that keeps inherited stdio
 * pipes open can keep that callback from ever firing, even after the tree
 * is killed. Cleanup still runs, but only to free resources, not to decide
 * when this promise settles.
 */
export function execute(file, {env, name, timeout = 60_000}, {start = spawnCommand, stop = stopProcessTree, log = console.log} = {}) {
	const startedAt = Date.now();
	const prefix = `[integration:${name}]`;
	log(`${prefix} start`);
	return new Promise((resolve, reject) => {
		let timedOut = false;
		let stdoutTail = '';
		let stderrTail = '';
		const child = start(process.execPath, [file], {
			env, detached: process.platform !== 'win32'
		}, (error, stdout, stderr) => {
			if (timedOut) {
				return;
			}
			clearTimeout(timer);
			log(`${prefix} finish elapsed=${Date.now() - startedAt}ms exit=${error?.code ?? 0}`);
			if (error && typeof error.code !== 'number') {
				reject(error);
				return;
			}
			resolve({code: error?.code ?? 0, stdout, stderr});
		});
		child.stdout?.on('data', chunk => { stdoutTail = tail(stdoutTail + chunk); });
		child.stderr?.on('data', chunk => { stderrTail = tail(stderrTail + chunk); });

		const timer = setTimeout(() => {
			timedOut = true;
			log(`${prefix} timeout elapsed=${Date.now() - startedAt}ms pid=${child.pid}`);
			Promise.resolve().then(() => stop(child)).catch(error => log(`${prefix} cleanup failed: ${error.message}`))
				.finally(() => releaseHandles(child));
			reject(Object.assign(new Error(
				`${name}: ${file} timed out after ${timeout}ms (pid=${child.pid})\nstdout:\n${stdoutTail}\nstderr:\n${stderrTail}`
			), {stdout: stdoutTail, stderr: stderrTail}));
		}, timeout);
	});
}
