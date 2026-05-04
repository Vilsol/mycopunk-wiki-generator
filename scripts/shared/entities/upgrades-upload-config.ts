// Upload-time entity config for upgrades. Pulled into a dedicated file so the
// shared `upload-pipeline.ts` registry can lazy-import it without dragging in
// the (heavy) generation-side enrichment + changelog modules.

import type { GenericGunUpgrade } from '../upgrades/types';
import {
	loadUpgrades,
	safeFilename,
	displayFilename,
	UPGRADE_CLASSIFIER_CONFIG,
	upgradePageTitle
} from './upgrades';
import type { EntityUploadConfig } from '../upload-pipeline';

export const upgradesUploadConfig: EntityUploadConfig<GenericGunUpgrade> = {
	name: 'upgrades',
	loadItems: () => loadUpgrades().filter((u) => u.UpgradeType !== 'Cosmetic'),
	pageTitle: upgradePageTitle,
	safeFilename,
	infoboxDescription: (u) => u.Description ?? '',
	identLabel: (u) => `${u.APIName} (ID: ${u.ID})`,
	classifier: UPGRADE_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (u) => `${displayFilename(u)}_Icon.png`,
			targetFilename: (u) => `${displayFilename(u)}_Icon.png`,
			description: (u) =>
				[
					`'''${u.Name}'''`,
					'',
					`Icon for the ${u.Name} upgrade in Mycopunk.`,
					'',
					`[[Category:Upgrade Icons]]`
				].join('\n')
		},
		{
			kind: 'pattern',
			sourceDirKind: 'svgs',
			suffix: '_Pattern.svg',
			localFilename: (u) => `${displayFilename(u)}_Pattern.svg`,
			targetFilename: (u) => `${displayFilename(u)}_Pattern.svg`,
			description: (u) =>
				[
					`'''${u.Name}'''`,
					'',
					`Hex pattern for the ${u.Name} upgrade in Mycopunk.`,
					'',
					`[[Category:Upgrade Patterns]]`
				].join('\n')
		}
	]
};
