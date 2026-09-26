import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';

const common = {bundle: true, platform: 'node', target: 'node22', metafile: true};
const main = await build({
	...common,
	entryPoints: ['src/index.js', 'src/install.js'],
	outdir: 'dist',
	outExtension: {'.js': '.mjs'},
	format: 'esm',
	banner: {js: "import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);"}
});
const loader = await build({
	...common,
	entryPoints: ['src/lib/config.js'],
	outfile: 'dist/config-loader.cjs',
	format: 'cjs'
});

const packages = new Set();
for (const input of [...Object.keys(main.metafile.inputs), ...Object.keys(loader.metafile.inputs)]) {
	const segments = input.replaceAll('\\', '/').split('/');
	const index = segments.lastIndexOf('node_modules');
	if (index === -1) {
		continue;
	}
	packages.add(segments.slice(0, index + (segments[index + 1].startsWith('@') ? 3 : 2)).join('/'));
}
const notices = [...packages].sort().map(directory => {
	const {name, version} = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
	const files = fs.readdirSync(directory).filter(file => /^(licen[cs]e|copying|notice)(\.|$)/i.test(file)).sort();
	if (!files.length) {
		throw new Error(`missing license notice for bundled dependency ${name}@${version}`);
	}
	return [`${name}@${version}`, ...files.map(file => fs.readFileSync(path.join(directory, file), 'utf8').trim())].join('\n\n');
});
fs.writeFileSync('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n---\n\n') + '\n');
