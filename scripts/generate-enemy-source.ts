// Generate Pattern-A wiki source + skeleton pages for every enemy.

import {
	buildEnemyContext,
	loadEnemies,
	loadEnemyGroups,
	enemyPageTitle,
	safeFilename
} from './shared/entities/enemies.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadEnemies();
	const groups = loadEnemyGroups();

	const result = await generateEntityPages({
		entityType: 'enemies',
		items,
		outputDir: entityOutputDir(import.meta.url, 'enemies', 'wiki-source'),
		templateName: 'enemy-source.wiki',
		skeletonTemplateName: 'enemy-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: enemyPageTitle,
		itemIdent: (e) => `${e.APIName ?? e.InternalName} (ID: ${e.ID})`,
		context: (e) => buildEnemyContext(e, groups.get(e.Name as string) ?? [e])
	});

	if (result.errors > 0) process.exit(1);
}

await main();
