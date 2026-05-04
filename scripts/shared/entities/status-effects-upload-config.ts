import type { StatusEffect } from '../data/schema.d';
import {
	loadStatusEffects,
	displayFilename,
	safeFilename,
	statusEffectPageTitle,
	STATUS_EFFECT_CLASSIFIER_CONFIG
} from './status-effects';
import type { EntityUploadConfig } from '../upload-pipeline';

export const statusEffectsUploadConfig: EntityUploadConfig<StatusEffect> = {
	name: 'status-effects',
	loadItems: loadStatusEffects,
	pageTitle: statusEffectPageTitle,
	safeFilename,
	infoboxDescription: () => '', // Status effects have no Description field.
	identLabel: (e) => `${e.ID} (${e.Name ?? '?'})`,
	classifier: STATUS_EFFECT_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (e) => `${displayFilename(e)}_Icon.png`,
			targetFilename: (e) => `${displayFilename(e)}_Icon.png`,
			description: (e) =>
				[
					`'''${e.Name ?? e.ID}'''`,
					'',
					`Icon for the ${e.Name ?? e.ID} status effect in Mycopunk.`,
					'',
					`[[Category:Status Effect Icons]]`
				].join('\n')
		}
	]
};
