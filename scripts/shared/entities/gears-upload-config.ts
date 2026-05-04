// Upload-time entity config for gears.

import type { Gear } from '../data/schema.d';
import {
	loadGears,
	displayFilename,
	gearPageTitle,
	safeFilename,
	GEAR_CLASSIFIER_CONFIG
} from './gears';
import type { EntityUploadConfig } from '../upload-pipeline';

export const gearsUploadConfig: EntityUploadConfig<Gear> = {
	name: 'gears',
	loadItems: loadGears,
	pageTitle: gearPageTitle,
	safeFilename,
	infoboxDescription: (g) => g.Description ?? '',
	identLabel: (g) => `${g.APIName} (ID: ${g.ID})`,
	classifier: GEAR_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (g) => `${displayFilename(g)}_Icon.png`,
			targetFilename: (g) => `${displayFilename(g)}_Icon.png`,
			description: (g) =>
				[
					`'''${g.Name}'''`,
					'',
					`Icon for the ${g.Name} gear in Mycopunk.`,
					'',
					`[[Category:Gear Icons]]`
				].join('\n')
		}
	]
};
