// Extract directive (mission modifier) icons from the game's spritesheets.

import { loadDirectives, displayFilename } from './shared/load-directives.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-directive-icons.ts <path-to-spritesheets-directory>', {
	items: loadDirectives(),
	outputDir: entityOutputDir(import.meta.url, 'directives', 'icons'),
	entityLabelPlural: 'directives',
	identLabel: (d) => `${d.Name} (ID: ${d.ID})`,
	getTexture: (d) => d.Icon ?? null,
	getDisplayName: (d) => displayFilename(d)
});
