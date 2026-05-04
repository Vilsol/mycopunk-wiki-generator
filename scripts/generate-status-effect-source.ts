// Generate Pattern-A wiki source + skeleton pages for every status effect.

import {
	buildStatusEffectContext,
	loadStatusEffects,
	safeFilename,
	statusEffectPageTitle
} from './shared/entities/status-effects.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadStatusEffects();

	const result = await generateEntityPages({
		entityType: 'status-effects',
		items,
		outputDir: entityOutputDir(import.meta.url, 'status-effects', 'wiki-source'),
		templateName: 'status-effect-source.wiki',
		skeletonTemplateName: 'status-effect-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: statusEffectPageTitle,
		itemIdent: (e) => `${e.ID}`,
		context: (e) => buildStatusEffectContext(e)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
