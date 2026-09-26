import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const DEFAULT_CONFIG_NAMES = ['.pa11yci', '.pa11yci.json', '.pa11yci.js', '.pa11yci.cjs'];

export async function loadConfig({configPath, config}) {
	if (configPath) {
		config = /\.(cjs|mjs|js)$/.test(configPath) ?
			await (await import(pathToFileURL(configPath).href)).default :
			JSON.parse(fs.readFileSync(configPath, 'utf8'));
	}
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('pa11y-ci config must export an object');
	}
	const defaults = config.defaults ?? {};
	if (typeof defaults !== 'object' || Array.isArray(defaults)) {
		throw new Error('pa11y-ci config defaults must be an object');
	}
	const urls = config.urls ?? [];
	if (!Array.isArray(urls)) {
		throw new Error('pa11y-ci config urls must be an array');
	}
	const seen = new Set();
	for (const entry of urls) {
		const url = typeof entry === 'string' ? entry : entry?.url;
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error('each pa11y-ci config URL must be a non-empty string or an object with a url');
		}
		if (seen.has(url)) {
			throw new Error(`duplicate URL "${url}": use separate action steps for different scenarios of the same URL`);
		}
		seen.add(url);
	}
	for (const options of [config, defaults, ...urls.filter(url => typeof url === 'object')]) {
		if (options.threshold !== undefined && options.threshold !== 0) {
			throw new Error('config thresholds can hide issues; remove them and use the action threshold input');
		}
	}
	// The CLI owns stdout; caller reporters must not add a second report.
	return {...config, defaults: {...defaults, reporters: []}, urls};
}

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
