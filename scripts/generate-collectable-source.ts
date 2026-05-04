// Generate Pattern-A wiki source + skeleton pages for every collectable.

import {
	buildCollectableContext,
	loadCollectables,
	collectablePageTitle,
	safeFilename
} from './shared/entities/collectables.ts';
import { loadUpgradesByID } from './shared/entities/characters.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadCollectables();
	const upgradesByID = loadUpgradesByID();

	const result = await generateEntityPages({
		entityType: 'collectables',
		items,
		outputDir: entityOutputDir(import.meta.url, 'collectables', 'wiki-source'),
		templateName: 'collectable-source.wiki',
		skeletonTemplateName: 'collectable-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: collectablePageTitle,
		itemIdent: (c) => `${c.ID} (${c.Name ?? '(no name)'})`,
		context: (c) => buildCollectableContext(c, upgradesByID)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
