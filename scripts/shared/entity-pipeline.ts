import fs from 'node:fs';
import path from 'node:path';
import { Eta } from 'eta';
import { ensureDir, getProjectRoot } from './paths';

// Generic generation pipeline. Each entity provides a loader + per-item
// context builder + template names; the runner does the eta setup, output-dir
// creation, the per-item render+write loop, and summary reporting.

export interface EntityPipelineOptions<T> {
	entityType: string;
	items: T[];
	outputDir: string;
	templateName: string; // .source.wiki template
	skeletonTemplateName?: string; // optional .skeleton.wiki template
	filenameFn: (item: T) => string;
	titleFn: (item: T) => string; // for log output
	context: (item: T) => Record<string, unknown> | Promise<Record<string, unknown>>;
	// Extra files to write into outputDir alongside per-item pages — e.g. a
	// shared "Related Pages" navigation template. Keyed by filename.
	extraFiles?: () => Record<string, string>;
	// Identifier used in error logs. Pass the item's id/api-name accessor.
	itemIdent: (item: T) => string;
}

export interface EntityPipelineResult {
	success: number;
	errors: number;
}

export async function generateEntityPages<T>(
	opts: EntityPipelineOptions<T>
): Promise<EntityPipelineResult> {
	const projectRoot = getProjectRoot(import.meta.url);
	const eta = new Eta({
		views: path.join(projectRoot, 'scripts/templates'),
		autoTrim: false
	});

	ensureDir(opts.outputDir);

	if (opts.extraFiles) {
		for (const [name, content] of Object.entries(opts.extraFiles())) {
			fs.writeFileSync(path.join(opts.outputDir, name), content, 'utf8');
		}
	}

	console.log(`Processing ${opts.items.length} ${opts.entityType}…`);

	let success = 0;
	let errors = 0;

	for (const item of opts.items) {
		try {
			const ctx = await opts.context(item);
			const sourceContent = eta.render(opts.templateName, ctx);
			const base = opts.filenameFn(item);
			const sourceFile = path.join(opts.outputDir, `${base}.source.wiki`);
			fs.writeFileSync(sourceFile, sourceContent, 'utf8');

			let skeletonName = '';
			if (opts.skeletonTemplateName) {
				const skeletonContent = eta.render(opts.skeletonTemplateName, ctx);
				const skeletonFile = path.join(opts.outputDir, `${base}.skeleton.wiki`);
				fs.writeFileSync(skeletonFile, skeletonContent, 'utf8');
				skeletonName = path.basename(skeletonFile);
			}

			const title = opts.titleFn(item);
			console.log(`✓ ${title}`);
			console.log(`    source: ${title}/source  →  ${path.basename(sourceFile)}`);
			if (skeletonName) console.log(`    host:   ${title}            →  ${skeletonName}`);
			success++;
		} catch (e) {
			console.error(`✗ Error generating ${opts.entityType} ${opts.itemIdent(item)}:`, e);
			errors++;
		}
	}

	console.log(`\n=== Summary ===`);
	console.log(`✓ Generated: ${success}`);
	console.log(`✗ Errors:    ${errors}`);
	console.log(`📁 Output:   ${opts.outputDir}`);

	return { success, errors };
}
