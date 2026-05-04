import type { Enemy } from '../data/schema.d';
import { loadEnemies, enemyPageTitle, safeFilename, ENEMY_CLASSIFIER_CONFIG } from './enemies';
import type { EntityUploadConfig } from '../upload-pipeline';

export const enemiesUploadConfig: EntityUploadConfig<Enemy> = {
	name: 'enemies',
	loadItems: loadEnemies,
	pageTitle: enemyPageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: (e) => `${e.APIName ?? e.InternalName} (ID: ${e.ID})`,
	classifier: ENEMY_CLASSIFIER_CONFIG,
	// Icons are deferred — the dump has no Icon.Texture/Rect for enemies.
	// Add a fileType entry once an asset source is identified.
	fileTypes: []
};
