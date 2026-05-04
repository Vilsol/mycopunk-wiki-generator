// Extract upgrade icons from the game's Unity spritesheets, tinted with the
// upgrade's rarity color (composited as an alpha-mask onto a solid-color rect).

import { loadUpgrades, displayFilename } from './shared/load-upgrades.ts';
import { parseRGBA } from './shared/upgrades/utils.ts';
import { entityOutputDir } from './shared/paths.ts';
import { runIconExtractor } from './shared/icon-extractor.ts';

await runIconExtractor('pnpm generate:icons <path-to-spritesheets-directory>', {
	items: loadUpgrades(),
	outputDir: entityOutputDir(import.meta.url, 'upgrades', 'icons'),
	entityLabelPlural: 'upgrades',
	identLabel: (u) => `${u.APIName} (ID: ${u.ID})`,
	getTexture: (u) => u.Icon ?? null,
	getDisplayName: (u) => displayFilename(u),
	getTintColor: (u) => parseRGBA(u.Color)
});
