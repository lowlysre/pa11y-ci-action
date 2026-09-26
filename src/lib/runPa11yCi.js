import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import * as exec from '@actions/exec';
import * as core from '@actions/core';

/**
 * Resolve the installed `pa11y-ci` CLI binary. Invoked as a separate
 * process rather than imported as a library, so this stays a clean
 * process boundary against pa11y-ci's LGPL-3.0 license.
 */
export function resolveBinPath() {
	return process.env.PA11Y_CI_BIN || createRequire(import.meta.url).resolve('pa11y-ci/bin/pa11y-ci.js');
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
 * report, so `--threshold` isn't passed. Stdout feeds the report;
 * stderr is surfaced as a bounded warning.
 */
export async function runPa11yCi({cwd, configPath, config, sitemap}, {getExecOutput = exec.getExecOutput, binPath = resolveBinPath(), warning = core.warning} = {}) {
	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa11y-ci-action-'));
	const loader = fileURLToPath(new URL('./config-loader.cjs', import.meta.url));
	const preparedConfig = path.join(tempDirectory, 'config.cjs');
	fs.writeFileSync(preparedConfig,
		`module.exports = require(${JSON.stringify(loader)}).loadConfig(${JSON.stringify({configPath, config})});\n`);
	const args = [binPath, '--json', '--config', preparedConfig];
	if (sitemap) {
		args.push('--sitemap', sitemap);
	}

	try {
		const {exitCode, stdout, stderr} = await getExecOutput(`"${process.execPath}"`, args, {cwd, ignoreReturnCode: true, silent: true});

		if (exitCode !== 0 && exitCode !== 2) {
			throw new Error(`pa11y-ci exited with code ${exitCode}:\n${tail(stderr || stdout)}`);
		}
		if (stderr.trim()) {
			warning(tail(stderr.trim()));
		}

		try {
			return JSON.parse(stdout);
		} catch (error) {
			throw new Error(`could not parse pa11y-ci JSON output: ${error.message}\n${tail(stderr || stdout)}`);
		}
	} finally {
		fs.rmSync(tempDirectory, {recursive: true, force: true});
	}
}
