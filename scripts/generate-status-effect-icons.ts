// Extract status-effect icons from the game's Unity spritesheets.

import { loadStatusEffects, displayFilename } from './shared/load-status-effects.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor(
	'bun scripts/generate-status-effect-icons.ts <path-to-spritesheets-directory>',
	{
		items: loadStatusEffects(),
		outputDir: entityOutputDir(import.meta.url, 'status-effects', 'icons'),
		entityLabelPlural: 'status effects',
		identLabel: (e) => e.ID,
		getTexture: (e) => e.Icon ?? null,
		getDisplayName: (e) => displayFilename(e)
	}
);
