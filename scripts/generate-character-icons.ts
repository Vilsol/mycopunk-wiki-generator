// Extract character icons from the game's Unity spritesheets.

import { loadCharacters, displayFilename } from './shared/load-characters.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-character-icons.ts <path-to-spritesheets-directory>', {
	items: loadCharacters(),
	outputDir: entityOutputDir(import.meta.url, 'characters', 'icons'),
	entityLabelPlural: 'characters',
	identLabel: (c) => c.APIName ?? c.Name ?? c.ID,
	getTexture: (c) => c.Icon ?? null,
	getDisplayName: (c) => displayFilename(c)
});
