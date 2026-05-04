// Threat entity: formatter context + mission-rewards table.
//
// Each Threat tier carries `MissionRewards: LevelUnlockEntry[]` — same shape as
// gear LevelUnlocks. We render those into a wikitable on each threat's page.

import type { Threat } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { escapeWikiText } from '../wiki-text';
import { loadThreats, displayFilename, threatPageTitle, safeFilename } from '../load-threats';
import { loadUpgradesByID } from './characters';
import type { EntityClassifierConfig } from '../upload-pipeline';
import { rgbaToHex } from './format-utils';
import { buildRewardsTable } from './reward-utils';

export { loadThreats, displayFilename, threatPageTitle, safeFilename };

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildThreatContext(
	threat: Threat,
	upgradesByID: Map<string, GenericGunUpgrade>
): Record<string, unknown> {
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

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const THREAT_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'].map((s) => s.toLowerCase())
	),
	autoGenSections: new Set(['rewards', 'mission rewards', 'overview']),
	infoboxStripPattern: /\{\{Infobox threat[\s\S]*?\}\}/g
};

export function loadThreatGenerationData() {
	return {
		threats: loadThreats(),
		upgradesByID: loadUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
