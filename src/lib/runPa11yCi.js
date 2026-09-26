import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as exec from '@actions/exec';

/**
 * Resolve the installed `pa11y-ci` CLI binary. Invoked as a separate
 * process rather than imported as a library, so this stays a clean
 * process boundary against pa11y-ci's LGPL-3.0 license. `require` here
 * comes from the `createRequire` banner esbuild injects at bundle time
 * (see the `build` script in package.json), needed because `pa11y-ci`'s
 * own entrypoint is CommonJS.
 */
export function resolveBinPath() {
	return require.resolve('pa11y-ci/bin/pa11y-ci.js');
}

const MAX_ERROR_OUTPUT = 4000;

// Keep the end of long output: that's where the error usually is.
function tail(text) {
	return text.length > MAX_ERROR_OUTPUT ? `…${text.slice(-MAX_ERROR_OUTPUT)}` : text;
}

/**
 * Run pa11y-ci and return its parsed JSON report.
 *
 * pa11y-ci exits 2 when any URL has issues, so the exec call never throws
 * on a failing accessibility run, only on pa11y-ci itself crashing (bad
 * config, no browser, etc). The action applies its own threshold to the
 * report, so `--threshold` isn't passed. Output isn't echoed to the log,
 * since the job summary replaces it; errors include a bounded excerpt.
 */
export async function runPa11yCi({cwd, configPath, config, sitemap}, {execFn = exec.exec, binPath} = {}) {
	const args = ['--json'];
	if (configPath) {
		args.push('--config', configPath);
	} else {
		args.push('--config', writeSyntheticConfig(cwd, config));
	}
	if (sitemap) {
		args.push('--sitemap', sitemap);
	}

	let stdout = '';
	let stderr = '';
	const exitCode = await execFn(`"${process.execPath}"`, [binPath ?? resolveBinPath(), ...args], {
		cwd,
		ignoreReturnCode: true,
		silent: true,
		listeners: {
			stdout: data => {
				stdout += data.toString();
			},
			stderr: data => {
				stderr += data.toString();
			}
		}
	});

	if (exitCode !== 0 && exitCode !== 2) {
		throw new Error(`pa11y-ci exited with code ${exitCode}:\n${tail(stderr || stdout)}`);
	}

	try {
		return JSON.parse(stdout);
	} catch (error) {
		throw new Error(`could not parse pa11y-ci JSON output: ${error.message}\n${tail(stderr || stdout)}`);
	}
}

function writeSyntheticConfig(cwd, config) {
	const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-')), 'config.json');
	fs.writeFileSync(configPath, JSON.stringify(config));
	return configPath;
}
