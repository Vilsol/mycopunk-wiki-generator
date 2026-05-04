// Resource entity: formatter context + cross-reference inversions.
// Every upgrade UnlockCost/OuroborosCost/TurbochargeCost and every gear
// LevelUnlock_Resource is inverted to a per-resource "Used by" table.

import type { Resource, Gear } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { descriptionToWiki, escapeWikiText, stripHtml } from '../wiki-text';
import { rgbaToHex } from './format-utils';
import {
	loadResources,
	plainName,
	displayFilename,
	safeFilename,
	resourcePageTitle
} from '../load-resources';
import { loadGears } from '../load-gears';
import { loadUpgrades } from '../load-upgrades';
import type { EntityClassifierConfig } from '../upload-pipeline';

export { loadResources, plainName, displayFilename, safeFilename, resourcePageTitle };

// ─────────────────────────────────────────────────────────────────────────
// Inversions
// ─────────────────────────────────────────────────────────────────────────

interface UpgradeUsage {
	upgrade: GenericGunUpgrade;
	context: 'unlock' | 'ouroboros' | 'turbocharge';
	count: number;
}

interface GearUsage {
	gear: Gear;
	level: number;
	count: number;
}

export interface ResourceUsage {
	upgrades: Map<string, UpgradeUsage[]>; // keyed by resource ID
	gears: Map<string, GearUsage[]>;
}

function pushUpgradeUsage(
	map: Map<string, UpgradeUsage[]>,
	resourceID: string,
	usage: UpgradeUsage
) {
	if (!resourceID) return;
	const list = map.get(resourceID) ?? [];
	list.push(usage);
	map.set(resourceID, list);
}

export function loadResourceUsage(): ResourceUsage {
	const upgrades = new Map<string, UpgradeUsage[]>();
	const gears = new Map<string, GearUsage[]>();

	// Dedupe by APIName+context so multiple data-dump entries for the same
	// upgrade (e.g. 4× "Constellation" skin variants) collapse into a single
	// row. Also skip Cosmetic upgrades — they're skin pages, not gameplay.
	const seen = new Map<string, UpgradeUsage>();
	const upsert = (resourceID: string, usage: UpgradeUsage) => {
		if (!resourceID) return;
		const key = `${resourceID}|${usage.upgrade.APIName}|${usage.context}`;
		const prior = seen.get(key);
		if (prior) {
			// Same upgrade+context already recorded; keep the one with higher
			// count (in practice they're identical).
			if ((usage.count ?? 0) > (prior.count ?? 0)) prior.count = usage.count;
			return;
		}
		seen.set(key, usage);
		pushUpgradeUsage(upgrades, resourceID, usage);
	};

	for (const u of loadUpgrades()) {
		if (u.UpgradeType === 'Cosmetic') continue;
		for (const c of u.UnlockCost ?? []) {
			upsert(c.ResourceID ?? c.Resource ?? '', {
				upgrade: u,
				context: 'unlock',
				count: c.Count ?? 0
			});
		}
		for (const c of u.OuroborosCost ?? []) {
			upsert(c.ResourceID ?? c.Resource ?? '', {
				upgrade: u,
				context: 'ouroboros',
				count: c.Count ?? 0
			});
		}
		for (const c of u.TurbochargeCost ?? []) {
			upsert(c.ResourceID ?? c.Resource ?? '', {
				upgrade: u,
				context: 'turbocharge',
				count: c.Count ?? 0
			});
		}
	}

	for (const g of loadGears()) {
		for (const lu of g.LevelUnlocks ?? []) {
			if (lu.Type !== 'LevelUnlock_Resource') continue;
			const r = lu.Resource;
			if (!r) continue;
			const id = r.ResourceID ?? r.Resource ?? '';
			if (!id) continue;
			const list = gears.get(id) ?? [];
			list.push({ gear: g, level: lu.Level ?? 0, count: r.Count ?? 0 });
			gears.set(id, list);
		}
	}

	for (const list of upgrades.values()) {
		list.sort((a, b) => stripHtml(a.upgrade.Name).localeCompare(stripHtml(b.upgrade.Name)));
	}
	for (const list of gears.values()) {
		list.sort((a, b) => a.level - b.level || a.gear.Name.localeCompare(b.gear.Name));
	}

	return { upgrades, gears };
}

// ─────────────────────────────────────────────────────────────────────────
// Used-by tables
// ─────────────────────────────────────────────────────────────────────────

const CONTEXT_LABELS: Record<UpgradeUsage['context'], string> = {
	unlock: 'Unlock',
	ouroboros: 'Ouroboros',
	turbocharge: 'Turbocharge'
};

function buildUsedByUpgrades(usages: UpgradeUsage[]): string {
	if (usages.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Upgrade !! Context !! Cost'];
	for (const u of usages) {
		const name = stripHtml(u.upgrade.Name);
		out.push('|-');
		out.push(`| [[${name} Upgrade|${name}]] || ${CONTEXT_LABELS[u.context]} || ${u.count}`);
	}
	out.push('|}');
	return out.join('\n');
}

function buildUsedByGears(usages: GearUsage[]): string {
	if (usages.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Gear !! Level !! Count'];
	for (const u of usages) {
		out.push('|-');
		out.push(`| [[${u.gear.Name}]] || ${u.level} || ${u.count}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildResourceContext(
	resource: Resource,
	usage: ResourceUsage
): Record<string, unknown> {
	const name = plainName(resource);
	const upgradeUsages = usage.upgrades.get(resource.ID) ?? [];
	const gearUsages = usage.gears.get(resource.ID) ?? [];

	return {
		name: escapeWikiText(name),
		pageTitle: resourcePageTitle(resource),
		apiName: escapeWikiText(resource.ID),
		rarity: resource.Rarity ?? '',
		max: resource.Max ?? 0,
		isItem: resource.IsItem ? 'Yes' : 'No',
		visibility: resource.Visibility ?? '',
		colorHex: rgbaToHex(resource.IconColor, true) || rgbaToHex(resource.Color, true),
		descriptionText: descriptionToWiki(resource.Description),
		seoDescription: stripHtml(resource.Description ?? `${name} resource in Mycopunk.`).slice(
			0,
			280
		),
		icon: `${displayFilename(resource)}_Icon.png`,
		usedByUpgrades: buildUsedByUpgrades(upgradeUsages),
		usedByGears: buildUsedByGears(gearUsages),
		hasUsedByUpgrades: upgradeUsages.length > 0,
		hasUsedByGears: gearUsages.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const RESOURCE_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'acquisition', 'strategy', 'trivia', 'notes', 'bugs', 'patch history'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set(['used by upgrades', 'used by gears', 'description', 'overview']),
	infoboxStripPattern: /\{\{Infobox resource[\s\S]*?\}\}/g
};

// Re-export for the icon extractor.
export function loadResourceGenerationData() {
	return {
		resources: loadResources(),
		usage: loadResourceUsage(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
