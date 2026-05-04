// Generate Pattern-A wiki source + skeleton pages for every (non-cosmetic)
// upgrade. The actual rendering is done by the generic `entity-pipeline`;
// this script just wires up the upgrade-specific loader, context builder,
// and changelog history.

import {
	loadUpgrades,
	safeFilename,
	buildUpgradeContext,
	buildRelatedPagesTemplate,
	loadUpgradeChangelogHistory,
	loadUpgradeEnrichment,
	renderUpgradeChangelog,
	upgradePageTitle
} from './shared/entities/upgrades.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main(filterAPIName?: string) {
	const all = loadUpgrades();

	// Skip cosmetic skins: their `Name`s collide on the wiki ("Factory" applies
	// to 23 gears, etc.) and they have no meaningful stat data, so they'd
	// produce near-empty pages that overwrite each other. Generator caller can
	// still target a specific cosmetic by APIName for ad-hoc testing.
	const items = filterAPIName
		? all.filter((u) => u.APIName === filterAPIName)
		: all.filter((u) => u.UpgradeType !== 'Cosmetic');

	if (filterAPIName && items.length === 0) {
		console.error(`No upgrade found with APIName="${filterAPIName}"`);
		console.error('Hint: try one of:');
		for (const u of all.slice(0, 10)) console.error(`  - ${u.APIName}`);
		process.exit(1);
	}

	const enrichment = loadUpgradeEnrichment();
	const history = await loadUpgradeChangelogHistory();

	const result = await generateEntityPages({
		entityType: 'upgrades',
		items,
		outputDir: entityOutputDir(import.meta.url, 'upgrades', 'wiki-source'),
		templateName: 'upgrade-source.wiki',
		skeletonTemplateName: 'upgrade-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: upgradePageTitle,
		itemIdent: (u) => `${u.APIName} (ID: ${u.ID})`,
		context: (u) => buildUpgradeContext(u, enrichment, renderUpgradeChangelog(history, u)),
		extraFiles: () => ({
			'_Template_Related_Pages.wiki': buildRelatedPagesTemplate()
		})
	});

	if (result.errors > 0) process.exit(1);
}

const filterAPIName = process.argv[2];
await main(filterAPIName);
