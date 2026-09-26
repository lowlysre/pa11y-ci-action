import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as exec from '@actions/exec';

export async function installPa11yCi(version, {
	execute = exec.exec,
	tempDirectory = process.env.RUNNER_TEMP || os.tmpdir(),
	nodeVersion = process.versions.node
} = {}) {
	if (Number(nodeVersion.split('.')[0]) < 22) {
		throw new Error(`pa11y-ci-action requires Node.js 22 or newer; found ${nodeVersion}. Run actions/setup-node before this action.`);
	}
	if (!version?.trim()) {
		throw new Error('pa11y-ci-version must not be empty');
	}
	const directory = fs.mkdtempSync(path.join(tempDirectory, 'pa11y-ci-action-runtime-'));
	const manifest = path.join(directory, 'package.json');
	fs.writeFileSync(manifest, JSON.stringify({private: true, dependencies: {'pa11y-ci': version}}));
	await execute('npm', [
		'install', '--prefix', directory, '--omit=dev', '--ignore-scripts=false',
		'--no-audit', '--no-fund', '--no-save', '--package-lock=false', '--loglevel=error'
	], {cwd: directory});
	return createRequire(manifest).resolve('pa11y-ci/bin/pa11y-ci.js');
}
