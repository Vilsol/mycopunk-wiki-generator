// Pull the latest game-data dump and JSON schema from the hosted repo at
// https://mycopunk-data.pages.dev. Idempotent — when the local active
// version already matches the manifest's `latest`, the data payload is
// skipped (only the schema is refreshed, since it's short-cached and
// might fix a typo without bumping the game version).
//
// Active state lives entirely under .dump-cache/:
//   .dump-cache/<version>.json   per-version dump snapshot
//   .dump-cache/current          one-line pointer to active version
//   .dump-cache/schema.json      JSON schema for the active version
//
// Run before `generate:types` and any generator so the rest of the
// pipeline always operates on a known-current snapshot.

import fs from 'node:fs';
import path from 'node:path';
import {
	currentSchemaPath,
	fetchManifest,
	fetchVersionDump,
	getCurrentVersion,
	setCurrentVersion
} from './shared/dump-cache.ts';
import { ensureDir, getProjectRoot } from './shared/paths.ts';

const PROJECT_ROOT = getProjectRoot(import.meta.url);
const BASE_URL = 'https://mycopunk-data.pages.dev';

async function main() {
	const versionArg = process.argv.find((a) => a.startsWith('--version='));
	const requestedVersion = versionArg?.slice('--version='.length);
	const force = process.argv.includes('--force');

	console.log(`Fetching index from ${BASE_URL}/index.json…`);
	const index = await fetchManifest();
	const target = requestedVersion ?? index.latest;
	const entry = index.versions.find((v) => v.version === target);
	if (!entry) {
		console.error(
			`Version "${target}" not in manifest. Available: ${index.versions.map((v) => v.version).join(', ')}`
		);
		process.exit(1);
	}
	console.log(
		`Manifest latest: ${index.latest}; targeting ${target} (${entry.buildId}, dumped ${entry.dumpedAt}).`
	);

	const localVersion = getCurrentVersion();
	if (!force && localVersion === target) {
		console.log(`Active version is already ${target}; skipping data fetch.`);
	} else {
		console.log(`Loading dump for ${target}…`);
		await fetchVersionDump(target);
		setCurrentVersion(target);
		console.log(`Active version → ${target}.`);
	}

	const schemaPath = currentSchemaPath();
	console.log(`Refreshing schema…`);
	const schemaRes = await fetch(`${BASE_URL}/schema/data.schema.json`);
	if (!schemaRes.ok) {
		throw new Error(
			`GET ${BASE_URL}/schema/data.schema.json → ${schemaRes.status} ${schemaRes.statusText}`
		);
	}
	const schemaText = await schemaRes.text();
	ensureDir(path.dirname(schemaPath));
	fs.writeFileSync(schemaPath, schemaText, 'utf8');
	console.log(
		`Wrote ${formatBytes(schemaText.length)} → ${path.relative(PROJECT_ROOT, schemaPath)}.`
	);
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
