// Threat entity: per-tier mission rewards table + classifier config.
//
// Each Threat tier carries `MissionRewards: LevelUnlockEntry[]` — same shape as
// gear LevelUnlocks. We render those into a wikitable on each threat's page.

import type { Threat } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName } from '../wiki-text';
import { defineEntity, lazyLoad, loadFromDump } from '../entity-registry';
import { loadUpgradesByID } from './characters';
import { rgbaToHex } from '../format-utils';
import { buildRewardsTable } from '../reward-utils';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export const loadThreats = loadFromDump<Threat>({ dumpKey: 'threats' });

export function safeFilename(threat: Threat): string {
	return sanitizeAPIName(threat.ID);
}

export function displayFilename(threat: Threat): string {
	const name = threat.Name || threat.ID;
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function threatPageTitle(threat: Threat): string {
	return threat.Name || threat.NumberLabel || threat.ID;
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

const getUpgradesByID = lazyLoad(loadUpgradesByID);

export function buildThreatContext(threat: Threat): Record<string, unknown> {
	const upgradesByID = getUpgradesByID();
	const rewardsSection = buildRewardsTable(threat.MissionRewards, { upgradesByID });
	const tierNum = threat.ID.replace(/^threat/, '');

	return {
		name: escapeWikiText(threat.Name ?? threat.ID),
		pageTitle: threatPageTitle(threat),
		apiName: escapeWikiText(threat.ID),
		numberLabel: threat.NumberLabel ?? '',
		tierNum,
		colorHex: rgbaToHex(threat.Color),
		icon: `${displayFilename(threat)}_Icon.png`,
		seoDescription: `${threat.Name ?? threat.ID} — ${threat.NumberLabel ?? 'mission threat tier'} in Mycopunk.`,
		rewardsSection,
		hasRewardsSection: rewardsSection.length > 0
	};
}

export function loadThreatGenerationData() {
	return {
		threats: loadThreats(),
		upgradesByID: getUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Threat>({
	name: 'threats',
	dumpKey: 'threats',
	loadItems: loadThreats,
	safeFilename,
	displayFilename,
	pageTitle: threatPageTitle,
	identLabel: (t) => `${t.ID} (${t.Name ?? '(no name)'})`,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['rewards', 'mission rewards', 'overview'],
		infoboxTemplateName: 'Infobox threat'
	},
	templateName: 'threat-source.wiki',
	skeletonTemplateName: 'threat-skeleton.wiki',
	contextBuilder: buildThreatContext,
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
	],
	icon: {
		getTexture: (t) => t.Icon ?? null
	}
});
