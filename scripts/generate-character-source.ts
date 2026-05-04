// Generate Pattern-A wiki source + skeleton pages for every character.

import {
	buildCharacterContext,
	loadCharacters,
	characterPageTitle,
	safeFilename
} from './shared/entities/characters.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadCharacters();

	const result = await generateEntityPages({
		entityType: 'characters',
		items,
		outputDir: entityOutputDir(import.meta.url, 'characters', 'wiki-source'),
		templateName: 'character-source.wiki',
		skeletonTemplateName: 'character-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: characterPageTitle,
		itemIdent: (c) => c.APIName ?? c.Name,
		context: (c) => buildCharacterContext(c)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
