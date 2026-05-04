// Generate Pattern-A wiki source + skeleton pages for every directive
// (mission modifier in wiki vocabulary).

import {
	buildDirectiveContext,
	loadDirectives,
	loadDirectiveGroups,
	directivePageTitle,
	safeFilename
} from './shared/entities/directives.ts';
import { loadUpgradesByID } from './shared/entities/characters.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadDirectives();
	const groups = loadDirectiveGroups();
	const upgradesByID = loadUpgradesByID();

	const result = await generateEntityPages({
		entityType: 'directives',
		items,
		outputDir: entityOutputDir(import.meta.url, 'directives', 'wiki-source'),
		templateName: 'directive-source.wiki',
		skeletonTemplateName: 'directive-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: directivePageTitle,
		itemIdent: (d) => `${d.Name} (ID: ${d.ID})`,
		context: (d) => buildDirectiveContext(d, upgradesByID, groups.get(d.Name as string) ?? [d])
	});

	if (result.errors > 0) process.exit(1);
}

await main();
