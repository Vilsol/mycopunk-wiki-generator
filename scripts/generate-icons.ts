// Unified icon-extractor dispatcher: pulls each entity's `icon` spec from
// the registry and runs the shared sprite-rect → PNG pipeline.
//
// Usage:
//   bun scripts/generate-icons.ts --entity=upgrades <spritesheets-path>
//   bun scripts/generate-icons.ts --all <spritesheets-path>
//
// Per-entity wiring (getTexture, optional getTintColor) lives in the
// `defineEntity({...icon: {...}})` block inside `scripts/shared/entities/<name>.ts`.

import path from 'node:path';
import { extractIcons } from './shared/icon-extractor.ts';
import { entityOutputDir } from './shared/paths.ts';
import { getEntity, knownEntities } from './shared/entity-registry.ts';

interface CliOpts {
	entity?: string;
	all: boolean;
	spritesheetsPath?: string;
}

function parseArgs(argv: string[]): CliOpts {
	const opts: CliOpts = { all: false };
	for (const a of argv) {
		if (a.startsWith('--entity=')) opts.entity = a.slice('--entity='.length);
		else if (a === '--all') opts.all = true;
		else if (a === '--help' || a === '-h') {
			console.log(`Usage: bun scripts/generate-icons.ts [options] <spritesheets-path>

Options:
  --entity=NAME       Extract icons for one entity. Required unless --all.
                      Known: ${knownEntities().join(', ')}
  --all               Extract icons for every entity that registers an
                      icon spec (skips ones that don't).
  --help, -h          Show this help.

The spritesheets-path is the absolute path to the unpacked Unity
Texture2D directory, e.g.
  ~/MycopunkExtracted/v1.8.2/ExportedProject/Assets/Texture2D
`);
			process.exit(0);
		} else if (!a.startsWith('--')) {
			opts.spritesheetsPath = a;
		} else {
			console.warn(`Unknown argument: ${a}`);
		}
	}
	return opts;
}

async function extractOne(name: string, spritesheetsPath: string): Promise<number> {
	const entity = await getEntity(name);
	if (!entity.icon) {
		console.error(`Entity '${name}' has no icon spec — skipping.`);
		return 0; // not an error; just nothing to do
	}
	const items = entity.loadItems();
	const result = await extractIcons({
		items,
		outputDir: entityOutputDir(import.meta.url, entity.name, 'icons'),
		spritesheetsPath: path.resolve(spritesheetsPath),
		entityLabelPlural: entity.name,
		identLabel: entity.identLabel,
		getTexture: entity.icon.getTexture,
		getDisplayName: entity.displayFilename,
		getTintColor: entity.icon.getTintColor
	});
	return result.errors > 0 ? 1 : 0;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!opts.entity && !opts.all) {
		console.error('Pass --entity=<name> or --all. See --help.');
		process.exit(2);
	}
	if (!opts.spritesheetsPath) {
		console.error('Spritesheets path is required as a positional argument. See --help.');
		process.exit(2);
	}

	const targets = opts.all ? knownEntities() : [opts.entity!];
	let exitCode = 0;
	for (const name of targets) {
		const code = await extractOne(name, opts.spritesheetsPath);
		if (code !== 0) exitCode = code;
	}
	process.exit(exitCode);
}

await main();
