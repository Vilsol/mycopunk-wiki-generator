// Generate the singleton Crafting page (Pattern-A /source + skeleton).

import {
	buildCraftingContext,
	loadCrafting,
	craftingPageTitle,
	safeFilename
} from './shared/entities/crafting.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadCrafting();
	const result = await generateEntityPages({
		entityType: 'crafting',
		items,
		outputDir: entityOutputDir(import.meta.url, 'crafting', 'wiki-source'),
		templateName: 'crafting-source.wiki',
		skeletonTemplateName: 'crafting-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: craftingPageTitle,
		itemIdent: () => 'crafting',
		context: (c) => buildCraftingContext(c)
	});
	if (result.errors > 0) process.exit(1);
}

await main();
