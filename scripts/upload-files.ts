// Generic file uploader. Dispatches on `--entity=NAME` to pick which entity's
// icons/patterns to upload from `generated-icons/<entity>/` and
// `generated-svgs/<entity>/`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { entityOutputDir, getProjectRoot } from './shared/paths.ts';
import { checkFileExistsAndHash, loginBot, uploadFile } from './shared/wiki-client.ts';
import {
	createRateLimiter,
	knownEntities,
	resolveEntity,
	type EntityFileSpec,
	type EntityUploadConfig
} from './shared/upload-pipeline.ts';
import { loadGameVersion } from './shared/dump.ts';
import { prepareTitleResolution } from './shared/title-resolver.ts';

const RATE_LIMIT_MS = 1000;

interface CliOptions {
	entity: string;
	all: boolean;
	kindFilter?: string; // e.g. "icon" or "pattern"
	dryRun: boolean;
	forceOverwrite: boolean;
}

interface UploadResult {
	filename: string;
	kind: string;
	itemLabel: string;
	success: boolean;
	skipped?: boolean;
	reason?: string;
	error?: string;
}

function calculateFileSHA1(filePath: string): string {
	const hashSum = crypto.createHash('sha1');
	hashSum.update(fs.readFileSync(filePath));
	return hashSum.digest('hex');
}

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = { entity: '', all: false, dryRun: false, forceOverwrite: false };
	for (const arg of argv) {
		if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--force-overwrite') opts.forceOverwrite = true;
		else if (arg === '--all') opts.all = true;
		else if (arg.startsWith('--entity=')) opts.entity = arg.slice('--entity='.length);
		else if (arg.startsWith('--kind=')) opts.kindFilter = arg.slice('--kind='.length);
		else if (arg === '--help' || arg === '-h') {
			console.log(`Usage: bun scripts/upload-files.ts (--entity=NAME | --all) [options]

Required (one of):
  --entity=NAME           One entity (${knownEntities().join(' | ')})
  --all                   Every registered entity that has uploadable files

Options:
  --kind=KIND             Limit to one file kind (e.g. icon, pattern)
  --dry-run               Simulate uploads without actually uploading
  --force-overwrite       Skip existence/SHA1 check; always overwrite
  --help, -h              Show this help
`);
			process.exit(0);
		} else {
			console.warn(`Unknown argument: ${arg}`);
		}
	}
	if (!opts.entity && !opts.all) {
		console.error('Pass --entity=<name> or --all.');
		process.exit(1);
	}
	return opts;
}

// Module-level rate limiter so a single `--all` run shares one budget across
// every entity instead of resetting between them.
const sharedRateLimit = createRateLimiter(RATE_LIMIT_MS);

async function uploadOne(
	entityName: string,
	options: CliOptions,
	gameVersion: string
): Promise<{ success: number; errors: number; skipped: number; failed: UploadResult[] }> {
	const config = (await resolveEntity(entityName)) as EntityUploadConfig<unknown>;
	console.log(`\n──── ${config.name} ────`);

	const items = config.loadItems();

	type Job = {
		item: unknown;
		spec: EntityFileSpec<unknown>;
		localPath: string;
	};
	const jobs: Job[] = [];

	const fileTypes = options.kindFilter
		? config.fileTypes.filter((ft) => ft.kind === options.kindFilter)
		: config.fileTypes;
	if (fileTypes.length === 0) {
		console.log(
			`(no file types${options.kindFilter ? ` match --kind=${options.kindFilter}` : ''})`
		);
		return { success: 0, errors: 0, skipped: 0, failed: [] };
	}

	for (const spec of fileTypes) {
		const sourceDir = entityOutputDir(import.meta.url, config.name, spec.sourceDirKind);
		if (!fs.existsSync(sourceDir)) {
			console.warn(`⚠ ${spec.kind}s directory not found: ${sourceDir}`);
			continue;
		}
		const present = new Set(fs.readdirSync(sourceDir).filter((f) => f.endsWith(spec.suffix)));
		for (const item of items) {
			const localFile = spec.localFilename(item);
			if (!present.has(localFile)) continue;
			jobs.push({
				item,
				spec,
				localPath: path.join(sourceDir, localFile)
			});
		}
	}

	if (jobs.length === 0) {
		console.log(`(no files generated yet — skip)`);
		return { success: 0, errors: 0, skipped: 0, failed: [] };
	}

	console.log(`Found ${jobs.length} file(s) to upload.`);

	const results: UploadResult[] = [];
	let success = 0;
	let errors = 0;
	let skipped = 0;

	jobs.sort((a, b) => config.identLabel(a.item).localeCompare(config.identLabel(b.item)));

	for (let i = 0; i < jobs.length; i++) {
		const { item, spec, localPath } = jobs[i];
		const targetFilename = spec.targetFilename(item);
		const itemLabel = config.identLabel(item);
		const filename = path.basename(localPath);

		console.log(`[${i + 1}/${jobs.length}] ${spec.kind}: ${itemLabel}`);

		try {
			if (!options.forceOverwrite && !options.dryRun) {
				const { exists, sha1: existingSha1 } = await checkFileExistsAndHash(targetFilename);
				if (exists && existingSha1) {
					const localSha1 = calculateFileSHA1(localPath);
					if (localSha1 === existingSha1) {
						console.log(`   ⏭ identical (sha1 ${localSha1.slice(0, 8)}…) — skip`);
						results.push({
							filename,
							kind: spec.kind,
							itemLabel,
							success: true,
							skipped: true,
							reason: 'identical SHA1'
						});
						skipped++;
						continue;
					}
				}
			}

			if (options.dryRun) {
				console.log(`   [dry-run] would upload → ${targetFilename}`);
				results.push({
					filename,
					kind: spec.kind,
					itemLabel,
					success: true,
					skipped: true,
					reason: 'dry-run'
				});
				skipped++;
				continue;
			}

			const description = spec.description(item);
			const comment = `Uploaded ${spec.kind} for ${itemLabel} (${gameVersion})\n\n${description}`;

			await sharedRateLimit();
			await uploadFile(localPath, targetFilename, comment, true);
			console.log(`   ✓ uploaded → ${targetFilename}`);
			results.push({ filename, kind: spec.kind, itemLabel, success: true });
			success++;
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			console.error(`   ✗ ${error.split('\n')[0]}`);
			results.push({
				filename,
				kind: spec.kind,
				itemLabel,
				success: false,
				error
			});
			errors++;
		}
	}

	const failed = results.filter((r) => !r.success);
	return { success, errors, skipped, failed };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	await prepareTitleResolution();
	const gameVersion = loadGameVersion();
	console.log(`Game version (from data.json): ${gameVersion}`);
	if (options.dryRun) console.log('🔍 DRY RUN — no uploads will happen');

	if (!options.dryRun) {
		console.log('Logging in to MediaWiki API…');
		await loginBot(getProjectRoot(import.meta.url));
	}

	const targets = options.all ? knownEntities() : [options.entity];

	let totalSuccess = 0;
	let totalErrors = 0;
	let totalSkipped = 0;
	const allFailed: UploadResult[] = [];

	for (const name of targets) {
		const r = await uploadOne(name, options, gameVersion);
		totalSuccess += r.success;
		totalErrors += r.errors;
		totalSkipped += r.skipped;
		allFailed.push(...r.failed);
	}

	console.log(`\n=== Total ===`);
	console.log(`✓ Uploaded: ${totalSuccess}`);
	console.log(`⏭  Skipped:  ${totalSkipped}`);
	console.log(`✗ Errors:   ${totalErrors}`);

	if (totalErrors > 0) {
		console.log(`\nFailed uploads:`);
		for (const r of allFailed) {
			console.log(`  - ${r.filename} (${r.kind} for ${r.itemLabel}): ${r.error}`);
		}
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
