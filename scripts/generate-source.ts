// Unified source-generator dispatcher: emits `<name>.source.wiki` and
// `<name>.skeleton.wiki` (where applicable) for one or all entities.
//
// Per-entity wiring lives in `scripts/shared/entities/<entity>.ts` (the
// `defineEntity({...})` block). This script just dispatches to the
// registered entity's context builder + templates.
//
// Usage:
//   bun scripts/generate-source.ts --entity=status-effects
//   bun scripts/generate-source.ts --entity=gears --filter=accelerator
//   bun scripts/generate-source.ts --all
//
// `--filter=<APIName>` is supported for entities that key on APIName.

import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';
import { getEntity, knownEntities } from './shared/entity-registry.ts';

interface CliOpts {
	entity?: string;
	all: boolean;
	filter?: string;
}

function parseArgs(argv: string[]): CliOpts {
	const opts: CliOpts = { all: false };
	for (const a of argv) {
		if (a.startsWith('--entity=')) opts.entity = a.slice('--entity='.length);
		else if (a.startsWith('--filter=')) opts.filter = a.slice('--filter='.length);
		else if (a === '--all') opts.all = true;
		else if (a === '--help' || a === '-h') {
			console.log(`Usage: bun scripts/generate-source.ts [options]

Options:
  --entity=NAME       Generate source pages for one entity. Required unless --all.
                      Known: ${knownEntities().join(', ')}
  --filter=APIName    Limit to one item (entity must key on APIName).
  --all               Generate for every registered entity.
  --help, -h          Show this help.
`);
			process.exit(0);
		} else {
			console.warn(`Unknown argument: ${a}`);
		}
	}
	return opts;
}

async function generateOne(name: string, filterAPIName?: string): Promise<number> {
	const entity = await getEntity(name);
	let items = entity.loadItems();

	if (filterAPIName) {
		const before = items.length;
		items = items.filter((it) => {
			const rec = it as Record<string, unknown>;
			return rec.APIName === filterAPIName;
		});
		if (items.length === 0) {
			console.error(`No ${name} item with APIName="${filterAPIName}" (out of ${before} entries).`);
			return 1;
		}
	}

	const result = await generateEntityPages({
		entityType: entity.name,
		items,
		outputDir: entityOutputDir(import.meta.url, entity.name, 'wiki-source'),
		templateName: entity.templateName,
		skeletonTemplateName: entity.skeletonTemplateName,
		filenameFn: entity.safeFilename,
		titleFn: entity.pageTitle,
		itemIdent: entity.identLabel,
		context: entity.contextBuilder,
		extraFiles: entity.extraFiles
	});

	return result.errors > 0 ? 1 : 0;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!opts.entity && !opts.all) {
		console.error('Pass --entity=<name> or --all. See --help.');
		process.exit(2);
	}

	const targets = opts.all ? knownEntities() : [opts.entity!];
	let exitCode = 0;
	for (const name of targets) {
		const code = await generateOne(name, opts.filter);
		if (code !== 0) exitCode = code;
	}
	process.exit(exitCode);
}

await main();
