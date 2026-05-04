// Extract threat icons from the game's Unity spritesheets.

import { loadThreats, displayFilename } from './shared/load-threats.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-threat-icons.ts <path-to-spritesheets-directory>', {
	items: loadThreats(),
	outputDir: entityOutputDir(import.meta.url, 'threats', 'icons'),
	entityLabelPlural: 'threats',
	identLabel: (t) => t.ID,
	getTexture: (t) => t.Icon ?? null,
	getDisplayName: (t) => displayFilename(t)
});
