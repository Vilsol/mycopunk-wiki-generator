// Generate Pattern-A wiki source + skeleton pages for every non-secret mission.

import {
	buildMissionContext,
	loadMissions,
	missionPageTitle,
	safeFilename,
	loadMissionGenerationData
} from './shared/entities/missions.ts';
import { generateEntityPages } from './shared/entity-pipeline.ts';
import { entityOutputDir } from './shared/paths.ts';

async function main() {
	const items = loadMissions();
	const {
		objectivesByName,
		directivesByRef,
		globalEventsByRef,
		enemyNamesByKey,
		enemiesByLowercasedKey,
		localizationByPrefix
	} = loadMissionGenerationData();

	const result = await generateEntityPages({
		entityType: 'missions',
		items,
		outputDir: entityOutputDir(import.meta.url, 'missions', 'wiki-source'),
		templateName: 'mission-source.wiki',
		skeletonTemplateName: 'mission-skeleton.wiki',
		filenameFn: safeFilename,
		titleFn: missionPageTitle,
		itemIdent: (m) => `${m.PlainName ?? m.ID} (${m.ID})`,
		context: (m) =>
			buildMissionContext(
				m,
				objectivesByName,
				directivesByRef,
				globalEventsByRef,
				enemyNamesByKey,
				enemiesByLowercasedKey,
				localizationByPrefix
			)
	});

	if (result.errors > 0) process.exit(1);
}

await main();
