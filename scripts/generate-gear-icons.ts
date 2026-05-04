// Extract gear icons from the game's Unity spritesheets.

import { loadGears, displayFilename } from './shared/load-gears.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-gear-icons.ts <path-to-spritesheets-directory>', {
	items: loadGears(),
	outputDir: entityOutputDir(import.meta.url, 'gears', 'icons'),
	entityLabelPlural: 'gears',
	identLabel: (g) => `${g.APIName} (ID: ${g.ID})`,
	getTexture: (g) => g.Icon ?? null,
	getDisplayName: (g) => displayFilename(g)
});
