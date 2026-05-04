import type { Collectable } from '../data/schema.d';
import {
	loadCollectables,
	displayFilename,
	collectablePageTitle,
	safeFilename,
	COLLECTABLE_CLASSIFIER_CONFIG
} from './collectables';
import type { EntityUploadConfig } from '../upload-pipeline';

export const collectablesUploadConfig: EntityUploadConfig<Collectable> = {
	name: 'collectables',
	loadItems: loadCollectables,
	pageTitle: collectablePageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: (c) => `${c.ID} (${c.Name ?? '(no name)'})`,
	classifier: COLLECTABLE_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (c) => `${displayFilename(c)}_Icon.png`,
			targetFilename: (c) => `${displayFilename(c)}_Icon.png`,
			description: (c) =>
				[
					`'''${c.Name ?? c.ID}'''`,
					'',
					`Icon for the ${c.Name ?? c.ID} collectable in Mycopunk.`,
					'',
					`[[Category:Collectable Icons]]`
				].join('\n')
		}
	]
};
