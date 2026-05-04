// Rarity entity: per-tier cost ladders, scrap-resource cross-ref, color chip.
// Cross-refs: every upgrade has a `Rarity` field equal to one of the
// TitleCased rarity names (Standard, Rare, …) — these pages give those links
// a target.

import type { RarityEntry, DUnlockCost } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import {
	loadRarities,
	displayFilename,
	rarityDisplay,
	rarityPageTitle,
	safeFilename
} from '../load-rarities';
import { loadUpgrades } from '../load-upgrades';
import { rgbaToHex } from './format-utils';
import type { EntityClassifierConfig } from '../upload-pipeline';

export { loadRarities, displayFilename, rarityDisplay, rarityPageTitle, safeFilename };

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

export function buildRarityContext(
	rarity: RarityEntry,
	upgradesByRarity: Map<string, GenericGunUpgrade[]>
): Record<string, unknown> {
	const display = rarityDisplay(rarity);
	const upgrades = upgradesByRarity.get(rarity.Name) ?? [];

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

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const RARITY_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'].map((s) => s.toLowerCase())
	),
	autoGenSections: new Set(['costs', 'upgrades', 'overview']),
	infoboxStripPattern: /\{\{Infobox rarity[\s\S]*?\}\}/g
};

export function loadRarityGenerationData() {
	return {
		rarities: loadRarities(),
		upgradesByRarity: loadUpgradesByRarity(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
