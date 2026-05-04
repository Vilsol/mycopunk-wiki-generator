import type { UpgradePresetEntry } from '../data/schema.d';
import {
	loadUpgradePresets,
	presetPageTitle,
	safeFilename,
	PRESET_CLASSIFIER_CONFIG
} from './upgrade-presets';
import type { EntityUploadConfig } from '../upload-pipeline';

export const upgradePresetsUploadConfig: EntityUploadConfig<UpgradePresetEntry> = {
	name: 'upgrade-presets',
	loadItems: loadUpgradePresets,
	pageTitle: presetPageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: (p) => p.Name,
	classifier: PRESET_CLASSIFIER_CONFIG,
	fileTypes: []
};
