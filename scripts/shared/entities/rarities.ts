// Rarity entity: per-tier cost ladders, scrap-resource cross-ref, color chip.
// Cross-refs: every upgrade has a `Rarity` field equal to one of the
// TitleCased rarity names (Standard, Rare, …) — these pages give those links
// a target.

import type { RarityEntry, DUnlockCost } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import { defineEntity, lazyLoad, loadFromDump } from '../entity-registry';
import { loadUpgrades } from './upgrades';
import { rgbaToHex } from '../format-utils';
import { parseRGBA } from '../upgrades/utils';
import { RARITY_ORDER_LOWER, rarityDisplay as displayRarity } from '../rarity-display';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

// Stable sort by power tier.
export const loadRarities = loadFromDump<RarityEntry>({
	dumpKey: 'rarities',
	sort: (a, b) => {
		const ai = RARITY_ORDER_LOWER.indexOf(a.Name);
		const bi = RARITY_ORDER_LOWER.indexOf(b.Name);
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
	}
});

// Title-Case the dump's lowercased rarity names: "exotic" → "Exotic".
export function rarityDisplay(r: RarityEntry): string {
	return displayRarity(r.Name);
}

export function safeFilename(r: RarityEntry): string {
	return r.Name;
}

export function displayFilename(r: RarityEntry): string {
	return `${rarityDisplay(r)}_Rarity`;
}

// Page titles get a " Rarity" suffix to avoid collision with adjective uses
// (e.g. `Rare` could plausibly mean a category page).
export function rarityPageTitle(r: RarityEntry): string {
	return `${rarityDisplay(r)} Rarity`;
}

// ─────────────────────────────────────────────────────────────────────────
// Cost-list rendering
// ─────────────────────────────────────────────────────────────────────────

function renderCostList(costs: DUnlockCost[] | undefined): string {
	if (!costs || costs.length === 0) return '';
	const parts: string[] = [];
	for (const c of costs) {
		const name = c.Resource ?? c.ResourceID ?? 'Unknown';
		const count = c.Count ?? 0;
		parts.push(count > 0 ? `${count} [[${name}]]` : `[[${name}]]`);
	}
	return parts.join(' + ');
}

// ─────────────────────────────────────────────────────────────────────────
// Cross-ref: upgrades at this rarity
// ─────────────────────────────────────────────────────────────────────────

export function loadUpgradesByRarity(): Map<string, GenericGunUpgrade[]> {
	const out = new Map<string, GenericGunUpgrade[]>();
	for (const u of loadUpgrades()) {
		if (u.UpgradeType === 'Cosmetic') continue;
		const r = (u.Rarity ?? '').toLowerCase();
		if (!r) continue;
		const list = out.get(r) ?? [];
		list.push(u);
		out.set(r, list);
	}
	for (const list of out.values()) {
		list.sort((a, b) => stripHtml(a.Name).localeCompare(stripHtml(b.Name)));
	}
	return out;
}

function buildUpgradesTable(upgrades: GenericGunUpgrade[] | undefined): string {
	if (!upgrades || upgrades.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Upgrade !! Description'];
	for (const u of upgrades) {
		const name = stripHtml(u.Name);
		const desc = stripHtml(u.Description ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		out.push('|-');
		out.push(`| [[${name} Upgrade|${name}]] || ${desc}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

const getUpgradesByRarity = lazyLoad(loadUpgradesByRarity);

export function buildRarityContext(rarity: RarityEntry): Record<string, unknown> {
	const display = rarityDisplay(rarity);
	const upgrades = getUpgradesByRarity().get(rarity.Name) ?? [];

	return {
		name: escapeWikiText(display),
		pageTitle: rarityPageTitle(rarity),
		apiName: escapeWikiText(rarity.Name),
		colorHex: rgbaToHex(rarity.Color),
		bgHex: rgbaToHex(rarity.BackgroundColor),
		icon: `${displayFilename(rarity)}_Icon.png`,
		upgradeScripCost: rarity.UpgradeScripCost ?? 0,
		upgradeRareResourceCost: rarity.UpgradeRareResourceCost ?? 0,
		cleanseCost: rarity.CleanseCost ?? 0,
		craftNewSaxoniteCost: rarity.CraftNewSaxoniteCost ?? 0,
		additionalUpgradeCost: renderCostList(rarity.AdditionalUpgradeCost),
		scrapResource: rarity.ScrapResource ?? '',
		seoDescription: `${display} rarity tier in Mycopunk — costs, scrap resource, and the upgrades available at this tier.`,
		upgradesSection: buildUpgradesTable(upgrades),
		hasUpgradesSection: upgrades.length > 0,
		upgradeCount: upgrades.length
	};
}

export function loadRarityGenerationData() {
	return {
		rarities: loadRarities(),
		upgradesByRarity: getUpgradesByRarity(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<RarityEntry>({
	name: 'rarities',
	dumpKey: 'rarities',
	loadItems: loadRarities,
	safeFilename,
	displayFilename,
	pageTitle: rarityPageTitle,
	identLabel: (r) => r.Name,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['costs', 'upgrades', 'overview'],
		infoboxTemplateName: 'Infobox rarity'
	},
	templateName: 'rarity-source.wiki',
	skeletonTemplateName: 'rarity-skeleton.wiki',
	contextBuilder: buildRarityContext,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (r) => `${displayFilename(r)}_Icon.png`,
			targetFilename: (r) => `${displayFilename(r)}_Icon.png`,
			description: (r) =>
				[
					`'''${rarityDisplay(r)}'''`,
					'',
					`Icon for the ${rarityDisplay(r)} rarity tier in Mycopunk.`,
					'',
					`[[Category:Rarity Icons]]`
				].join('\n')
		}
	],
	icon: {
		getTexture: (r) => r.Icon ?? null,
		// All rarities share the same `Hex Icons` sprite at the same rect — the
		// game tints them with `RarityEntry.Color` at runtime. Mirror that here.
		getTintColor: (r) => (r.Color ? parseRGBA(r.Color) : null)
	}
});
