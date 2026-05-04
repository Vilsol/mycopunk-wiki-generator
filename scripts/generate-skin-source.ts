// Generate Pattern-A wiki source + skeleton pages for every skin (cosmetic
// upgrade with a Skin block).

import {
	buildSkinContext,
	loadSkins,
	skinPageTitle,
	safeFilename
} from './shared/entities/skins.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadSkins();

	const result = await generateEntityPages({
		entityType: 'skins',
		items,
		outputDir: entityOutputDir(import.meta.url, 'skins', 'wiki-source'),
		templateName: 'skin-source.wiki',
		skeletonTemplateName: 'skin-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: skinPageTitle,
		itemIdent: (s) => `skin_${s.upgrade.ID}`,
		context: (s) => buildSkinContext(s)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
