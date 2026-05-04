import type { Threat } from '../data/schema.d';
import {
	loadThreats,
	displayFilename,
	threatPageTitle,
	safeFilename,
	THREAT_CLASSIFIER_CONFIG
} from './threats';
import type { EntityUploadConfig } from '../upload-pipeline';

export const threatsUploadConfig: EntityUploadConfig<Threat> = {
	name: 'threats',
	loadItems: loadThreats,
	pageTitle: threatPageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: (t) => `${t.ID} (${t.Name ?? '(no name)'})`,
	classifier: THREAT_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (t) => `${displayFilename(t)}_Icon.png`,
			targetFilename: (t) => `${displayFilename(t)}_Icon.png`,
			description: (t) =>
				[
					`'''${t.Name ?? t.ID}'''`,
					'',
					`Icon for ${t.NumberLabel ?? t.ID} (${t.Name ?? t.ID}) in Mycopunk.`,
					'',
					`[[Category:Threat Icons]]`
				].join('\n')
		}
	]
};
