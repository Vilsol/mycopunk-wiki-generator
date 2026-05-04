// Collectable entity: formatter context + reward (always a single upgrade).

import type { Collectable } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { escapeWikiText } from '../wiki-text';
import {
	loadCollectables,
	displayFilename,
	collectablePageTitle,
	safeFilename
} from '../load-collectables';
import { loadUpgradesByID } from './characters';
import type { EntityClassifierConfig } from '../upload-pipeline';
import { buildRewardsTable } from './reward-utils';

export { loadCollectables, displayFilename, collectablePageTitle, safeFilename };

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildCollectableContext(
	c: Collectable,
	upgradesByID: Map<string, GenericGunUpgrade>
): Record<string, unknown> {
	const rewardsSection = buildRewardsTable(c.Rewards, { upgradesByID });

	const punchText = (c.PunchText ?? '').trim();
	return {
		name: escapeWikiText(c.Name ?? c.ID),
		pageTitle: collectablePageTitle(c),
		apiName: escapeWikiText(c.ID),
		count: c.Count ?? 0,
		seoDescription: `${c.Name ?? c.ID} — collectable (${c.Count ?? 0} pieces) in Mycopunk.`,
		icon: `${displayFilename(c)}_Icon.png`,
		punchText,
		hasPunchText: punchText.length > 0,
		rewardsSection,
		hasRewardsSection: rewardsSection.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const COLLECTABLE_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'locations', 'tips', 'trivia', 'notes', 'patch history'].map((s) => s.toLowerCase())
	),
	autoGenSections: new Set(['rewards', 'overview']),
	infoboxStripPattern: /\{\{Infobox collectable[\s\S]*?\}\}/g
};

export function loadCollectableGenerationData() {
	return {
		collectables: loadCollectables(),
		upgradesByID: loadUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
