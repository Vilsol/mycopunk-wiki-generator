// Generate Pattern-A wiki source + skeleton pages for every threat tier.

import {
	buildThreatContext,
	loadThreats,
	threatPageTitle,
	safeFilename
} from './shared/entities/threats.ts';
import { loadUpgradesByID } from './shared/entities/characters.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadThreats();
	const upgradesByID = loadUpgradesByID();

	const result = await generateEntityPages({
		entityType: 'threats',
		items,
		outputDir: entityOutputDir(import.meta.url, 'threats', 'wiki-source'),
		templateName: 'threat-source.wiki',
		skeletonTemplateName: 'threat-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: threatPageTitle,
		itemIdent: (t) => `${t.ID} (${t.Name ?? '(no name)'})`,
		context: (t) => buildThreatContext(t, upgradesByID)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
