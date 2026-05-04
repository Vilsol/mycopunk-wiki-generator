import type { MissionEntry } from '../load-missions';
import {
	loadMissions,
	displayFilename,
	missionPageTitle,
	safeFilename,
	MISSION_CLASSIFIER_CONFIG
} from './missions';
import type { EntityUploadConfig } from '../upload-pipeline';

export const missionsUploadConfig: EntityUploadConfig<MissionEntry> = {
	name: 'missions',
	loadItems: loadMissions,
	pageTitle: missionPageTitle,
	safeFilename,
	infoboxDescription: (m) => m.Description ?? '',
	identLabel: (m) => `${m.PlainName ?? m.ID} (${m.ID})`,
	classifier: MISSION_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (m) => `${displayFilename(m)}_Icon.png`,
			targetFilename: (m) => `${displayFilename(m)}_Icon.png`,
			description: (m) =>
				[
					`'''${m.PlainName ?? m.ID}'''`,
					'',
					`Icon for the ${m.PlainName ?? m.ID} mission in Mycopunk.`,
					'',
					`[[Category:Mission Icons]]`
				].join('\n')
		}
	]
};
