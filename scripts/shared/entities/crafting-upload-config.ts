import type { CraftingSingleton } from '../load-crafting';
import {
	loadCrafting,
	craftingPageTitle,
	safeFilename,
	CRAFTING_CLASSIFIER_CONFIG
} from './crafting';
import type { EntityUploadConfig } from '../upload-pipeline';

export const craftingUploadConfig: EntityUploadConfig<CraftingSingleton> = {
	name: 'crafting',
	loadItems: loadCrafting,
	pageTitle: craftingPageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: () => 'crafting',
	classifier: CRAFTING_CLASSIFIER_CONFIG,
	fileTypes: []
};
