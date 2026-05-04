// Extract collectable icons from the game's Unity spritesheets.

import { loadCollectables, displayFilename } from './shared/load-collectables.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor(
	'bun scripts/generate-collectable-icons.ts <path-to-spritesheets-directory>',
	{
		items: loadCollectables(),
		outputDir: entityOutputDir(import.meta.url, 'collectables', 'icons'),
		entityLabelPlural: 'collectables',
		identLabel: (c) => c.ID,
		getTexture: (c) => c.Icon ?? null,
		getDisplayName: (c) => displayFilename(c)
	}
);
