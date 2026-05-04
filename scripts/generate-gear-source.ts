// Generate Pattern-A wiki source + skeleton pages for every gear (gun /
// throwable / utility / vehicle / custom equipment) in the data dump.

import {
	buildGearContext,
	gearPageTitle,
	loadGears,
	loadUpgradesByGear,
	safeFilename
} from './shared/entities/gears.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main(filterAPIName?: string) {
	const all = loadGears();
	const items = filterAPIName ? all.filter((g) => g.APIName === filterAPIName) : all;

	if (filterAPIName && items.length === 0) {
		console.error(`No gear found with APIName="${filterAPIName}"`);
		console.error('Hint: try one of:');
		for (const g of all.slice(0, 10)) console.error(`  - ${g.APIName}`);
		process.exit(1);
	}

	const upgradesByGear = loadUpgradesByGear();

	const result = await generateEntityPages({
		entityType: 'gears',
		items,
		outputDir: entityOutputDir(import.meta.url, 'gears', 'wiki-source'),
		templateName: 'gear-source.wiki',
		skeletonTemplateName: 'gear-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: gearPageTitle,
		itemIdent: (g) => `${g.APIName} (ID: ${g.ID})`,
		context: (g) => buildGearContext(g, upgradesByGear)
	});

	if (result.errors > 0) process.exit(1);
}

const filterAPIName = process.argv[2];
await main(filterAPIName);
