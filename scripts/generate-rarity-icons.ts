// Extract rarity icons from the game's Unity spritesheets.
// All 6 rarities share the same `Hex Icons` sprite at the same rect — the
// game tints them with `RarityEntry.Color` at runtime. Mirror that here by
// passing `getTintColor`, the same way upgrade icons are tinted.

import { loadRarities, displayFilename } from './shared/load-rarities.ts';
import { parseRGBA } from './shared/upgrades/utils.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('bun scripts/generate-rarity-icons.ts <path-to-spritesheets-directory>', {
	items: loadRarities(),
	outputDir: entityOutputDir(import.meta.url, 'rarities', 'icons'),
	entityLabelPlural: 'rarities',
	identLabel: (r) => r.Name,
	getTexture: (r) => r.Icon ?? null,
	getDisplayName: (r) => displayFilename(r),
	getTintColor: (r) => (r.Color ? parseRGBA(r.Color) : null)
});
