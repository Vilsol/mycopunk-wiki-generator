// Generate Pattern-A wiki source + skeleton pages for every resource.

import {
	buildResourceContext,
	loadResources,
	loadResourceUsage,
	resourcePageTitle,
	safeFilename
} from './shared/entities/resources.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadResources();
	const usage = loadResourceUsage();

	const result = await generateEntityPages({
		entityType: 'resources',
		items,
		outputDir: entityOutputDir(import.meta.url, 'resources', 'wiki-source'),
		templateName: 'resource-source.wiki',
		skeletonTemplateName: 'resource-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: resourcePageTitle,
		itemIdent: (r) => r.ID,
		context: (r) => buildResourceContext(r, usage)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
