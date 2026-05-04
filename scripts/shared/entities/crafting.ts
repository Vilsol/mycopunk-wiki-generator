// Crafting singleton: the one CraftingWindow prefab's full price table.
// Wrapped in a one-element array so it plugs into the per-entity pipeline
// without special-casing.

import type { Crafting, DUnlockCost } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity } from '../entity-registry';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export interface CraftingSingleton extends Crafting {
	id: 'crafting';
}

export function loadCrafting(): CraftingSingleton[] {
	const data = readDump() as unknown as { crafting?: Crafting };
	if (!data?.crafting || typeof data.crafting !== 'object') {
		throw new Error(`Invalid data.json shape: expected a 'crafting' singleton object`);
	}
	return [{ ...data.crafting, id: 'crafting' }];
}

export function safeFilename(): string {
	return 'crafting';
}

export function displayFilename(): string {
	return 'Crafting';
}

export function craftingPageTitle(): string {
	return 'Crafting';
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

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

export function loadCraftingGenerationData() {
	return {
		crafting: loadCrafting(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<CraftingSingleton>({
	name: 'crafting',
	dumpKey: 'crafting', // singleton — loadFromDump not used; loadCrafting wraps it
	loadItems: loadCrafting,
	safeFilename,
	displayFilename,
	pageTitle: craftingPageTitle,
	identLabel: () => 'crafting',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['costs', 'crafting costs', 'overview'],
		infoboxTemplateName: 'Infobox crafting'
	},
	templateName: 'crafting-source.wiki',
	skeletonTemplateName: 'crafting-skeleton.wiki',
	contextBuilder: buildCraftingContext
	// no fileTypes — crafting has no icon
});
