import type { RarityEntry } from '../data/schema.d';
import {
	loadRarities,
	displayFilename,
	rarityPageTitle,
	rarityDisplay,
	safeFilename,
	RARITY_CLASSIFIER_CONFIG
} from './rarities';
import type { EntityUploadConfig } from '../upload-pipeline';

export const raritiesUploadConfig: EntityUploadConfig<RarityEntry> = {
	name: 'rarities',
	loadItems: loadRarities,
	pageTitle: rarityPageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: (r) => r.Name,
	classifier: RARITY_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (r) => `${displayFilename(r)}_Icon.png`,
			targetFilename: (r) => `${displayFilename(r)}_Icon.png`,
			description: (r) =>
				[
					`'''${rarityDisplay(r)}'''`,
					'',
					`Icon for the ${rarityDisplay(r)} rarity tier in Mycopunk.`,
					'',
					`[[Category:Rarity Icons]]`
				].join('\n')
		}
	]
};
