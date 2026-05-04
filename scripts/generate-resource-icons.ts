// Extract resource icons from the game's Unity spritesheets.

import { loadResources, displayFilename } from './shared/load-resources.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-resource-icons.ts <path-to-spritesheets-directory>', {
	items: loadResources(),
	outputDir: entityOutputDir(import.meta.url, 'resources', 'icons'),
	entityLabelPlural: 'resources',
	identLabel: (r) => r.ID,
	getTexture: (r) => r.Icon ?? null,
	getDisplayName: (r) => displayFilename(r)
});
