// Crafting singleton: the one CraftingWindow prefab's full price table.
// Wrapped in a one-element array so it plugs into the per-entity pipeline
// without special-casing.

import type { Crafting, DUnlockCost, PatternInfusion } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity } from '../entity-registry';
import { rarityCell, RARITY_ORDER_LOWER } from '../rarity-display';

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

export function loadPatternInfusion(): PatternInfusion | null {
	const data = readDump() as unknown as { patternInfusion?: PatternInfusion };
	return data.patternInfusion ?? null;
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

interface RarityCraftCosts {
	Name?: string;
	CraftNewSaxoniteCost?: number;
	CraftNewNormalResourceCost?: number;
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

// 999 is the dump's "can't be crafted at this rarity" sentinel (Oddity, Contraband).
const NOT_CRAFTABLE = 999;

const craftableCount = (n: number | undefined): string =>
	n === undefined || n >= NOT_CRAFTABLE ? '—' : String(n);

const titleCase = (s: string): string => s[0].toUpperCase() + s.slice(1);

type CostKey =
	| 'RandomCraftCost'
	| 'RandomNewCraftCost'
	| 'WeaponCraftCost'
	| 'WeaponNewCraftCost'
	| 'UpgradeCraftCost';

function buildRarityCostsTable(c: CraftingSingleton): string {
	const byRarity = c.ByRarity ?? {};
	const rarities = Object.keys(byRarity).sort(
		(a, b) => RARITY_ORDER_LOWER.indexOf(a) - RARITY_ORDER_LOWER.indexOf(b)
	);
	if (rarities.length === 0) return '';
	const ops: [string, CostKey][] = [
		['Random craft', 'RandomCraftCost'],
		['Random craft (new upgrade)', 'RandomNewCraftCost'],
		['Weapon craft', 'WeaponCraftCost'],
		['Weapon craft (new upgrade)', 'WeaponNewCraftCost'],
		['Upgrade craft', 'UpgradeCraftCost']
	];
	const out = [
		'{| class="wikitable"',
		`! Operation !! ${rarities.map((r) => rarityCell(titleCase(r))).join(' !! ')}`
	];
	for (const [label, key] of ops) {
		const cells = rarities.map((r) => renderCostList(byRarity[r][key]).replace(/ \+ /g, '<br/>'));
		out.push('|-');
		out.push(`| ${label} || ${cells.join(' || ')}`);
	}
	out.push('|}');
	return out.join('\n');
}

function buildNewCraftRarityTable(): string {
	const data = readDump() as unknown as { rarities?: Record<string, RarityCraftCosts> };
	const rarities = Object.values(data.rarities ?? {}).sort(
		(a, b) => RARITY_ORDER_LOWER.indexOf(a.Name ?? '') - RARITY_ORDER_LOWER.indexOf(b.Name ?? '')
	);
	if (rarities.length === 0) return '';
	const out = [
		'{| class="wikitable"',
		'! Rarity !! Saxonite for craft-new roll !! Base ingredient count'
	];
	for (const r of rarities) {
		out.push('|-');
		out.push(
			`| ${rarityCell(titleCase(r.Name ?? ''))} || ${craftableCount(r.CraftNewSaxoniteCost)} || ${craftableCount(r.CraftNewNormalResourceCost)}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

function buildInfusionSection(): string {
	const p = loadPatternInfusion();
	if (!p) return '';
	const resources = (readDump() as unknown as { resources?: Record<string, { Name?: string }> })
		.resources;
	const resourceName = resources?.[p.ResourceID ?? '']?.Name;
	const resource = resourceName ? `[[${resourceName}]]` : (p.ResourceID ?? 'resources');
	const base = p.BaseCost ?? 0;
	const perCell = p.CostPerCellDifference ?? 0;
	const min = p.MinCost ?? 0;
	const perRarity = p.CostPerRarityLevel ?? 0;
	const rarities = ['Standard', 'Rare', 'Epic', 'Exotic', 'Oddity', 'Contraband'];
	const cost = (diff: number, rarity: number) =>
		Math.max(base + diff * perCell, min) + rarity * perRarity;

	const out = [
		`The Pattern Infuser unlocks at player level ${p.UnlockLevel ?? '?'} and costs ${resource}.`,
		'',
		`<code>max(${base} + cellDifference × ${perCell}, ${min}) + targetRarity × ${perRarity}</code>`,
		'',
		`''cellDifference'' is the cell-count difference between the two upgrades. ''targetRarity'' is the rarity tier of the target upgrade (Standard = 0 up to Contraband = 5).`,
		'',
		'{| class="wikitable"',
		`! Cell difference !! ${rarities.map((r) => rarityCell(r)).join(' !! ')}`
	];
	for (let diff = -2; diff <= 6; diff++) {
		out.push('|-');
		out.push(`| ${diff} || ${rarities.map((_, i) => cost(diff, i)).join(' || ')}`);
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
		costsSection: buildCostsTable(c),
		rarityCostsSection: buildRarityCostsTable(c),
		newCraftRaritySection: buildNewCraftRarityTable(),
		infusionSection: buildInfusionSection()
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
		autoGenSections: ['costs', 'crafting costs', 'overview', 'pattern infusion'],
		infoboxTemplateName: 'Infobox crafting'
	},
	templateName: 'crafting-source.wiki',
	skeletonTemplateName: 'crafting-skeleton.wiki',
	contextBuilder: buildCraftingContext
	// no fileTypes — crafting has no icon
});
