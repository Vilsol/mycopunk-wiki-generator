// Generate Pattern-A wiki source + skeleton pages for each UpgradePreset.

import {
	buildPresetContext,
	loadUpgradePresets,
	loadSkinsByPreset,
	presetPageTitle,
	safeFilename
} from './shared/entities/upgrade-presets.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadUpgradePresets();
	const skinsByPreset = loadSkinsByPreset();
	const allPresets = new Map(items.map((p) => [p.Name, p]));

	const result = await generateEntityPages({
		entityType: 'upgrade-presets',
		items,
		outputDir: entityOutputDir(import.meta.url, 'upgrade-presets', 'wiki-source'),
		templateName: 'upgrade-preset-source.wiki',
		skeletonTemplateName: 'upgrade-preset-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: presetPageTitle,
		itemIdent: (p) => p.Name,
		context: (p) => buildPresetContext(p, skinsByPreset, allPresets)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
