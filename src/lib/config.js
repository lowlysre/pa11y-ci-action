import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CONFIG_NAMES = ['.pa11yci', '.pa11yci.json', '.pa11yci.js', '.pa11yci.cjs'];

/**
 * Find an existing pa11y-ci config file. Returns the path to use with `-c`,
 * or `null` if none exists and one should be synthesized from action inputs.
 */
export function findConfigPath(configInput, workingDirectory) {
	if (configInput) {
		const resolved = path.resolve(workingDirectory, configInput);
		if (!fs.existsSync(resolved)) {
			throw new Error(`config input was set to "${configInput}", but no file exists at ${resolved}`);
		}
		return resolved;
	}
	for (const name of DEFAULT_CONFIG_NAMES) {
		const candidate = path.join(workingDirectory, name);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Build a pa11y-ci config object from action inputs, for use when the
 * repo has no config file of its own. The sitemap isn't part of the
 * returned config: pa11y-ci only reads it from the `--sitemap` flag.
 *
 * Chromium's sandbox is off because ubuntu-latest's AppArmor policy
 * blocks it; this matches pa11y-ci's own guidance for CI.
 */
export function buildSyntheticConfig({urls, sitemap, standard, concurrency}) {
	if (!urls.length && !sitemap) {
		throw new Error('no config file was found and neither `urls` nor `sitemap` was provided');
	}
	return {
		defaults: {
			standard,
			concurrency,
			chromeLaunchConfig: {
				args: ['--no-sandbox']
			}
		},
		urls
	};
}

/**
 * Parse a whole-number action input, rejecting anything `parseInt` would
 * quietly accept (`2x`, `1.5`, blanks) or that falls below `min`.
 */
export function parseIntegerInput(name, value, {min}) {
	const trimmed = value.trim();
	const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
	if (!Number.isSafeInteger(parsed) || parsed < min) {
		throw new Error(`\`${name}\` must be a whole number of at least ${min}, got "${value}"`);
	}
	return parsed;
}

/**
 * Parse the newline-separated `urls` action input into an array,
 * dropping blank lines.
 */
export function parseUrlsInput(urlsInput) {
	return urlsInput
		.split('\n')
		.map(url => url.trim())
		.filter(Boolean);
}
