// Collectable entity: loader, identification, rewards table, registry.

import type { Collectable } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName } from '../wiki-text';
import { defaultIconFileType, defineEntity, lazyLoad, loadFromDump } from '../entity-registry';
import { loadUpgradesByID } from './characters';
import { buildRewardsTable } from '../reward-utils';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export const loadCollectables = loadFromDump<Collectable>({ dumpKey: 'collectables' });

export function safeFilename(c: Collectable): string {
	return sanitizeAPIName(c.ID);
}

export function displayFilename(c: Collectable): string {
	const name = c.Name || c.ID;
	if (!/[a-zA-Z0-9]/.test(name)) return sanitizeAPIName(c.ID);
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function collectablePageTitle(c: Collectable): string {
	return c.Name || c.ID;
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

const getUpgradesByID = lazyLoad(loadUpgradesByID);

export function buildCollectableContext(c: Collectable): Record<string, unknown> {
	const upgradesByID = getUpgradesByID();
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

export function loadCollectableGenerationData() {
	return {
		collectables: loadCollectables(),
		upgradesByID: getUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Collectable>({
	name: 'collectables',
	dumpKey: 'collectables',
	loadItems: loadCollectables,
	safeFilename,
	displayFilename,
	pageTitle: collectablePageTitle,
	identLabel: (c) => `${c.ID} (${c.Name ?? '(no name)'})`,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'locations', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['rewards', 'overview'],
		infoboxTemplateName: 'Infobox collectable'
	},
	templateName: 'collectable-source.wiki',
	skeletonTemplateName: 'collectable-skeleton.wiki',
	contextBuilder: buildCollectableContext,
	fileTypes: [
		defaultIconFileType<Collectable>({
			displayFilename,
			prettyName: (c) => c.Name ?? c.ID,
			categoryName: 'Collectable Icons',
			entityLabelSingular: 'collectable'
		})
	],
	icon: {
		getTexture: (c) => c.Icon ?? null
	}
});
