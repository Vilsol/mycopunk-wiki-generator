// Upload skin preview assets (jpg stills + animated webp 360° rotations) to
// the wiki.
//
// Each file in `generated-icons/skins/` whose name ends in `_Preview.jpg` or
// `_Preview.webp` is pushed under its existing filename. The parent skin is
// derived from the filename so we can write a meaningful File: page body.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { entityOutputDir, getProjectRoot } from './shared/paths.ts';
import { checkFileExistsAndHash, loginBot, uploadFile } from './shared/wiki-client.ts';
import { createRateLimiter } from './shared/upload-pipeline.ts';
import { loadGameVersion } from './shared/dump.ts';
import {
	loadSkins,
	plainName,
	displayFilename,
	skinPageTitle,
	variantPreviewFilename,
	type Skin
} from './shared/load-skins.ts';

const RATE_LIMIT_MS = 1000;

interface CliOptions {
	dryRun: boolean;
	forceOverwrite: boolean;
	stillsOnly: boolean;
	animationsOnly: boolean;
}

function calculateFileSHA1(filePath: string): string {
	const hashSum = crypto.createHash('sha1');
	hashSum.update(fs.readFileSync(filePath));
	return hashSum.digest('hex');
}

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		dryRun: false,
		forceOverwrite: false,
		stillsOnly: false,
		animationsOnly: false
	};
	for (const arg of argv) {
		if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--force-overwrite') opts.forceOverwrite = true;
		else if (arg === '--stills-only') opts.stillsOnly = true;
		else if (arg === '--animations-only') opts.animationsOnly = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(`Usage: bun scripts/upload-skin-previews.ts [options]

Options:
  --stills-only        Upload only .jpg stills
  --animations-only    Upload only .webp 360° rotations
  --dry-run            Simulate uploads without actually uploading
  --force-overwrite    Skip SHA1 check; always overwrite
  --help, -h           Show this help
`);
			process.exit(0);
		} else {
			console.warn(`Unknown argument: ${arg}`);
		}
	}
	return opts;
}

interface Job {
	skin: Skin;
	parent: string;
	preset: string;
	ext: 'jpg' | 'webp';
	localPath: string;
	targetFilename: string;
}

function collectJobs(opts: CliOptions): Job[] {
	const sourceDir = entityOutputDir(import.meta.url, 'skins', 'icons');
	if (!fs.existsSync(sourceDir)) {
		console.error(`✗ skins icons directory not found: ${sourceDir}`);
		process.exit(1);
	}
	const present = new Set(fs.readdirSync(sourceDir));
	const jobs: Job[] = [];
	for (const s of loadSkins()) {
		const previews = s.skin.Previews ?? {};
		for (const parent of Object.keys(previews)) {
			for (const preset of Object.keys(previews[parent] ?? {})) {
				for (const ext of ['jpg', 'webp'] as const) {
					if (opts.stillsOnly && ext !== 'jpg') continue;
					if (opts.animationsOnly && ext !== 'webp') continue;
					const filename = variantPreviewFilename(s, parent, preset, ext);
					if (!present.has(filename)) continue;
					jobs.push({
						skin: s,
						parent,
						preset,
						ext,
						localPath: path.join(sourceDir, filename),
						targetFilename: filename
					});
				}
			}
		}
	}
	return jobs;
}

function describePreviewFile(job: Job): string {
	const skinTitle = skinPageTitle(job.skin);
	const skinName = plainName(job.skin);
	const presetLabel = job.preset === 'base' ? 'Base' : job.preset.replace(/_/g, ' ');
	const kind = job.ext === 'jpg' ? 'still preview' : '360° animated rotation';
	return [
		`'''${skinName} — ${presetLabel}''' (${kind} on [[${job.parent}]])`,
		'',
		`Auto-generated ${kind} for the [[${skinTitle}|${skinName}]] skin variant in Mycopunk.`,
		'',
		'[[Category:Skin Previews]]',
		`[[Category:${job.ext === 'jpg' ? 'Skin Stills' : 'Skin Rotations'}]]`
	].join('\n');
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const gameVersion = loadGameVersion();
	console.log(`Game version (from data.json): ${gameVersion}`);

	const jobs = collectJobs(options);
	if (jobs.length === 0) {
		console.error('No preview files to upload. Did you run generate-skin-previews?');
		process.exit(1);
	}

	console.log(`Found ${jobs.length} file(s) to upload.`);
	if (options.dryRun) console.log('🔍 DRY RUN — no uploads will happen');

	if (!options.dryRun) {
		console.log('Logging in to MediaWiki API…');
		await loginBot(getProjectRoot(import.meta.url));
	}

	const rateLimit = createRateLimiter(RATE_LIMIT_MS);
	let success = 0;
	let errors = 0;
	let skipped = 0;

	jobs.sort((a, b) => a.targetFilename.localeCompare(b.targetFilename));

	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i];
		const ident = `${plainName(job.skin)} (${displayFilename(job.skin)}) — ${job.preset}/${job.ext}`;
		console.log(`[${i + 1}/${jobs.length}] ${ident}`);
		try {
			if (!options.forceOverwrite && !options.dryRun) {
				const { exists, sha1 } = await checkFileExistsAndHash(job.targetFilename);
				if (exists && sha1) {
					const local = calculateFileSHA1(job.localPath);
					if (local === sha1) {
						console.log(`   ⏭ identical — skip`);
						skipped++;
						continue;
					}
				}
			}

			if (options.dryRun) {
				console.log(`   [dry-run] would upload → ${job.targetFilename}`);
				skipped++;
				continue;
			}

			const description = describePreviewFile(job);
			const comment = `Skin preview for ${plainName(job.skin)} (${gameVersion})\n\n${description}`;

			await rateLimit();
			await uploadFile(job.localPath, job.targetFilename, comment, true);
			console.log(`   ✓ uploaded → ${job.targetFilename}`);
			success++;
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			console.error(`   ✗ ${error.split('\n')[0]}`);
			errors++;
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(`✓ Uploaded: ${success}`);
	console.log(`⏭  Skipped:  ${skipped}`);
	console.log(`✗ Errors:   ${errors}`);

	if (errors > 0) process.exit(1);
}

await main();
