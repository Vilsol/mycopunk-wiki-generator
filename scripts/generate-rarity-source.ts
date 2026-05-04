// Generate Pattern-A wiki source + skeleton pages for every rarity tier.

import {
	buildRarityContext,
	loadRarities,
	loadUpgradesByRarity,
	rarityPageTitle,
	safeFilename
} from './shared/entities/rarities.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadRarities();
	const upgradesByRarity = loadUpgradesByRarity();

	const result = await generateEntityPages({
		entityType: 'rarities',
		items,
		outputDir: entityOutputDir(import.meta.url, 'rarities', 'wiki-source'),
		templateName: 'rarity-source.wiki',
		skeletonTemplateName: 'rarity-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: rarityPageTitle,
		itemIdent: (r) => r.Name,
		context: (r) => buildRarityContext(r, upgradesByRarity)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
