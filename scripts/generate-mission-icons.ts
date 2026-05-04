// Extract mission icons from the game's Unity spritesheets.

import { loadMissions, displayFilename } from './shared/load-missions.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-mission-icons.ts <path-to-spritesheets-directory>', {
	items: loadMissions(),
	outputDir: entityOutputDir(import.meta.url, 'missions', 'icons'),
	entityLabelPlural: 'missions',
	identLabel: (m) => `${m.PlainName ?? m.ID} (${m.ID})`,
	getTexture: (m) => m.Icon ?? null,
	getDisplayName: (m) => displayFilename(m)
});
