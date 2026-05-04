// Crafting singleton: the one CraftingWindow prefab's full price table.

import type { DUnlockCost } from '../data/schema.d';
import { readDump } from '../dump';
import {
	loadCrafting,
	type CraftingSingleton,
	craftingPageTitle,
	safeFilename
} from '../load-crafting';
import type { EntityClassifierConfig } from '../upload-pipeline';

export { loadCrafting, craftingPageTitle, safeFilename };

function renderCostList(costs: DUnlockCost[] | undefined): string {
	if (!costs || costs.length === 0) return '—';
	const parts: string[] = [];
	for (const c of costs) {
		const name = c.Resource ?? c.ResourceID ?? 'Unknown';
		const count = c.Count ?? 0;
		parts.push(count > 0 ? `${count} [[${name}]]` : `[[${name}]]`);
	}
	return parts.join(' + ');
}

function buildCostsTable(c: CraftingSingleton): string {
	const out = ['{| class="wikitable"', '! Operation !! Cost'];
	const rows: [string, DUnlockCost[] | undefined][] = [
		['Random craft', c.RandomCraftCost],
		['Weapon craft', c.WeaponCraftCost],
		['Upgrade craft', c.UpgradeCraftCost],
		['Upcraft → Rare', c.UpcraftToRareCost],
		['Upcraft → Epic', c.UpcraftToEpicCost],
		['Upcraft → Exotic', c.UpcraftToExoticCost]
	];
	for (const [label, costs] of rows) {
		out.push('|-');
		out.push(`| ${label} || ${renderCostList(costs)}`);
	}
	out.push('|}');
	return out.join('\n');
}

export function buildCraftingContext(c: CraftingSingleton): Record<string, unknown> {
	return {
		name: 'Crafting',
		pageTitle: craftingPageTitle(),
		minLevel: c.MinLevelToAccessCrafting ?? 0,
		seoDescription: 'Crafting prices and tier-upgrade costs in Mycopunk.',
		costsSection: buildCostsTable(c)
	};
}

export const CRAFTING_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'].map((s) => s.toLowerCase())
	),
	autoGenSections: new Set(['costs', 'crafting costs', 'overview']),
	infoboxStripPattern: /\{\{Infobox crafting[\s\S]*?\}\}/g
};

export function loadCraftingGenerationData() {
	return {
		crafting: loadCrafting(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
