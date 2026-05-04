import type { CharacterEntry } from '../data/schema.d';
import {
	loadCharacters,
	displayFilename,
	safeFilename,
	characterPageTitle,
	CHARACTER_CLASSIFIER_CONFIG
} from './characters';
import type { EntityUploadConfig } from '../upload-pipeline';

export const charactersUploadConfig: EntityUploadConfig<CharacterEntry> = {
	name: 'characters',
	loadItems: loadCharacters,
	pageTitle: characterPageTitle,
	safeFilename,
	infoboxDescription: () => '',
	identLabel: (c) => `${c.APIName ?? c.Name}`,
	classifier: CHARACTER_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (c) => `${displayFilename(c)}_Icon.png`,
			targetFilename: (c) => `${displayFilename(c)}_Icon.png`,
			description: (c) =>
				[
					`'''${c.Name}'''`,
					'',
					`Icon for the ${c.Name} character in Mycopunk.`,
					'',
					`[[Category:Character Icons]]`
				].join('\n')
		},
		{
			kind: 'skill-tree',
			sourceDirKind: 'svgs',
			suffix: '_SkillTreeV7.svg',
			localFilename: (c) => `${displayFilename(c)}_SkillTreeV7.svg`,
			targetFilename: (c) => `${displayFilename(c)}_SkillTreeV7.svg`,
			description: (c) =>
				[
					`'''${c.Name} skill tree'''`,
					'',
					`Auto-generated skill tree map for ${c.Name}. Each node corresponds to an upgrade in the [[${c.Name}]] skill tree.`,
					'',
					`[[Category:Character Skill Trees]]`
				].join('\n')
		}
	]
};
