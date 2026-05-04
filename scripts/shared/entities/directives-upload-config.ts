import type { Directive } from '../data/schema.d';
import {
	loadDirectives,
	displayFilename,
	directivePageTitle,
	safeFilename,
	DIRECTIVE_CLASSIFIER_CONFIG
} from './directives';
import type { EntityUploadConfig } from '../upload-pipeline';

export const directivesUploadConfig: EntityUploadConfig<Directive> = {
	name: 'directives',
	loadItems: loadDirectives,
	pageTitle: directivePageTitle,
	safeFilename,
	infoboxDescription: (d) => d.Description ?? '',
	identLabel: (d) => `${d.Name} (ID: ${d.ID})`,
	classifier: DIRECTIVE_CLASSIFIER_CONFIG,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (d) => `${displayFilename(d)}_Icon.png`,
			targetFilename: (d) => `${displayFilename(d)}_Icon.png`,
			description: (d) =>
				[
					`'''${d.Name}'''`,
					'',
					`Icon for the ${d.Name} mission modifier in Mycopunk.`,
					'',
					`[[Category:Mission Modifier Icons]]`
				].join('\n')
		}
	]
};
