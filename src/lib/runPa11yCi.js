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

/**
 * Run pa11y-ci and return its parsed JSON report.
 *
 * pa11y-ci exits non-zero when the threshold is exceeded, so the exec
 * call never throws on a failing accessibility run, only on pa11y-ci
 * itself crashing (bad config, no browser, etc).
 */
export async function runPa11yCi({cwd, configPath, config, sitemap, threshold}) {
	const args = ['--json', '--threshold', String(threshold)];
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
	const exitCode = await exec.exec(`"${process.execPath}"`, [resolveBinPath(), ...args], {
		cwd,
		ignoreReturnCode: true,
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
		throw new Error(`pa11y-ci exited with code ${exitCode}:\n${stderr}`);
	}

	try {
		return JSON.parse(stdout);
	} catch (error) {
		throw new Error(`could not parse pa11y-ci JSON output: ${error.message}\n${stdout}`);
	}
}

function writeSyntheticConfig(cwd, config) {
	const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-')), 'config.json');
	fs.writeFileSync(configPath, JSON.stringify(config));
	return configPath;
}
