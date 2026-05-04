// Resource entity: loader, identification, used-by inversions, registry.
// Every upgrade UnlockCost/OuroborosCost/TurbochargeCost and every gear
// LevelUnlock_Resource is inverted to a per-resource "Used by" table.

import type { Resource, Gear } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import {
	descriptionToWiki,
	escapeWikiText,
	normalizeWikiTitle,
	sanitizeAPIName,
	stripHtml
} from '../wiki-text';
import { defineEntity, lazyLoad, loadFromDump } from '../entity-registry';
import { isColliding, RESOURCE_SUFFIX } from '../cross-entity-collisions';
import { rgbaToHex } from '../format-utils';
import { loadGears } from './gears';
import { loadUpgrades } from './upgrades';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export const loadResources = loadFromDump<Resource>({ dumpKey: 'resources' });

// Names may contain rich-text wrappers (e.g. `<font=H>Strange Components</font>`).
// Use the plain name for everything user-facing — page titles, file names,
// wikilinks.
export function plainName(resource: Resource): string {
	return stripHtml(resource.Name ?? resource.ID).trim();
}

export function safeFilename(resource: Resource): string {
	return sanitizeAPIName(resource.ID);
}

export function displayFilename(resource: Resource): string {
	const name = plainName(resource);
	if (!name || !/[a-zA-Z0-9]/.test(name)) return sanitizeAPIName(resource.ID);
	const base = normalizeWikiTitle(sanitizeAPIName(name));
	return isColliding(name) ? `${base}${RESOURCE_SUFFIX.filenameSuffix}` : base;
}

export function resourcePageTitle(resource: Resource): string {
	const name = plainName(resource);
	return isColliding(name) ? `${name}${RESOURCE_SUFFIX.titleSuffix}` : name;
}

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

const getUsage = lazyLoad(loadResourceUsage);

export function buildResourceContext(resource: Resource): Record<string, unknown> {
	const usage = getUsage();
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

export function loadResourceGenerationData() {
	return {
		resources: loadResources(),
		usage: getUsage(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Resource>({
	name: 'resources',
	dumpKey: 'resources',
	loadItems: loadResources,
	safeFilename,
	displayFilename,
	pageTitle: resourcePageTitle,
	identLabel: (r) => `${r.ID} (${plainName(r)})`,
	infoboxDescription: (r) => r.Description ?? '',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: [
			'lore',
			'acquisition',
			'strategy',
			'trivia',
			'notes',
			'bugs',
			'patch history'
		],
		autoGenSections: ['used by upgrades', 'used by gears', 'description', 'overview'],
		infoboxTemplateName: 'Infobox resource'
	},
	templateName: 'resource-source.wiki',
	skeletonTemplateName: 'resource-skeleton.wiki',
	contextBuilder: buildResourceContext,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (r) => `${displayFilename(r)}_Icon.png`,
			targetFilename: (r) => `${displayFilename(r)}_Icon.png`,
			description: (r) =>
				[
					`'''${plainName(r)}'''`,
					'',
					`Icon for the ${plainName(r)} resource in Mycopunk.`,
					'',
					`[[Category:Resource Icons]]`
				].join('\n')
		}
	],
	icon: {
		getTexture: (r) => r.Icon ?? null
	}
});
