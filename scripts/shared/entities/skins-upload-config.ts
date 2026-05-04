import type { Skin } from '../load-skins';
import { loadSkins, plainName, safeFilename, skinPageTitle, SKIN_CLASSIFIER_CONFIG } from './skins';
import type { EntityUploadConfig } from '../upload-pipeline';

export const skinsUploadConfig: EntityUploadConfig<Skin> = {
	name: 'skins',
	loadItems: loadSkins,
	pageTitle: skinPageTitle,
	safeFilename,
	infoboxDescription: (s) => s.upgrade.Description ?? '',
	identLabel: (s) => `${plainName(s)} (${s.parentDisplays.join('+') || 'orphan'} #${s.upgrade.ID})`,
	classifier: SKIN_CLASSIFIER_CONFIG,
	// Per-variant preview files (jpg + webm) are uploaded by the dedicated
	// `upload-skin-previews.ts` rather than the generic `--entity=skins` file
	// pipeline, because they aren't 1:1 with the entity.
	fileTypes: []
};
