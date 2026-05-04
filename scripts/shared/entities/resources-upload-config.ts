import type { Resource } from '../data/schema.d';
import {
	loadResources,
	displayFilename,
	plainName,
	safeFilename,
	resourcePageTitle,
	RESOURCE_CLASSIFIER_CONFIG
} from './resources';
import type { EntityUploadConfig } from '../upload-pipeline';

export const resourcesUploadConfig: EntityUploadConfig<Resource> = {
	name: 'resources',
	loadItems: loadResources,
	pageTitle: resourcePageTitle,
	safeFilename,
	infoboxDescription: (r) => r.Description ?? '',
	identLabel: (r) => `${r.ID} (${plainName(r)})`,
	classifier: RESOURCE_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (r) => `${displayFilename(r)}_Icon.png`,
			targetFilename: (r) => `${displayFilename(r)}_Icon.png`,
			description: (r) =>
				[
					`'''${plainName(r)}'''`,
					'',
					`Icon for the ${plainName(r)} resource in Mycopunk.`,
					'',
					`[[Category:Resource Icons]]`
				].join('\n')
		}
	]
};
