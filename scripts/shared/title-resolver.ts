// Cross-entity page-title collision resolution. The pure core
// (`resolveCollisions`) decides, for a map of base-title → occupants, which
// occupant keeps the bare title (highest entity-hierarchy rank) and which get
// a domain-specific `(label)` suffix. Within-entity collisions (same entity
// type) are reported but never rewritten.

export interface Occupant {
	entity: string; // entity name, e.g. 'gears'
	key: string; // stable per-item key, e.g. 'gears\x00kart'
	label: string; // domain-specific disambiguation label, e.g. 'Vehicle'
}

export interface ResolvedOccupant {
	key: string;
	entity: string;
	finalTitle: string;
	kept: boolean;
}

export interface CollisionGroup {
	baseTitle: string;
	kind: 'cross-entity' | 'within-entity';
	occupants: Occupant[];
	resolved?: ResolvedOccupant[]; // present for cross-entity groups
}

export interface CollisionReport {
	groups: CollisionGroup[];
	crossEntityCount: number;
	withinEntityCount: number;
}

export interface ResolveResult {
	overrides: Map<string, string>; // key → finalTitle (suffixed losers only)
	report: CollisionReport;
}

export function resolveCollisions(
	occupantsByTitle: Map<string, Occupant[]>,
	hierarchy: string[]
): ResolveResult {
	const rank = new Map(hierarchy.map((e, i) => [e, i]));
	const rankOf = (e: string) => rank.get(e) ?? Number.MAX_SAFE_INTEGER;

	const overrides = new Map<string, string>();
	const groups: CollisionGroup[] = [];
	let crossEntityCount = 0;
	let withinEntityCount = 0;

	for (const [baseTitle, occ] of occupantsByTitle) {
		if (occ.length < 2) continue;
		const distinctEntities = new Set(occ.map((o) => o.entity));
		if (distinctEntities.size > 1) {
			crossEntityCount++;
			const sorted = [...occ].sort(
				(a, b) =>
					rankOf(a.entity) - rankOf(b.entity) ||
					a.entity.localeCompare(b.entity) ||
					a.key.localeCompare(b.key)
			);
			const resolved: ResolvedOccupant[] = sorted.map((o, i) => {
				const kept = i === 0;
				const finalTitle = kept ? baseTitle : `${baseTitle} (${o.label})`;
				if (!kept) overrides.set(o.key, finalTitle);
				return { key: o.key, entity: o.entity, finalTitle, kept };
			});
			groups.push({ baseTitle, kind: 'cross-entity', occupants: occ, resolved });
		} else {
			withinEntityCount++;
			groups.push({ baseTitle, kind: 'within-entity', occupants: occ });
		}
	}

	return { overrides, report: { groups, crossEntityCount, withinEntityCount } };
}

import { knownEntities, getEntity } from './entity-registry.ts';

// Highest priority keeps the bare title. Only gears > enemies is exercised
// today; the rest is future-proofing.
export const ENTITY_HIERARCHY = [
	'characters',
	'gears',
	'upgrades',
	'skins',
	'enemies',
	'threats',
	'missions',
	'directives',
	'collectables',
	'crafting',
	'resources',
	'rarities',
	'status-effects',
	'upgrade-presets'
];

export function titleKey(entity: string, safeFilename: string): string {
	return `${entity}\x00${safeFilename}`;
}

// Default disambiguation label: Title-case + drop a trailing plural 's'.
export function defaultLabel(entityName: string): string {
	const singular = entityName.endsWith('s') ? entityName.slice(0, -1) : entityName;
	return singular.charAt(0).toUpperCase() + singular.slice(1);
}

let prepared = false;
let overridesCache = new Map<string, string>();
let reportCache: CollisionReport = { groups: [], crossEntityCount: 0, withinEntityCount: 0 };

// Load every entity once, build the override map + report. Memoized.
export async function prepareTitleResolution(): Promise<CollisionReport> {
	if (prepared) return reportCache;
	const byTitle = new Map<string, Occupant[]>();
	for (const name of knownEntities()) {
		// basePageTitle and disambiguationLabel are added to MaterializedEntity in Task 3.
		// Until then, cast to access them safely (both calls are try-guarded at runtime).
		const ent = (await getEntity(name)) as unknown as {
			uploadConfig: { loadItems: () => unknown[]; safeFilename: (i: unknown) => string };
			basePageTitle: (i: unknown) => string;
			disambiguationLabel?: (i: unknown) => string;
		};
		let items: unknown[];
		try {
			items = ent.uploadConfig.loadItems();
		} catch {
			continue;
		}
		for (const item of items) {
			let base: string;
			try {
				base = ent.basePageTitle(item);
			} catch {
				continue;
			}
			const key = titleKey(name, ent.uploadConfig.safeFilename(item));
			const label = ent.disambiguationLabel ? ent.disambiguationLabel(item) : defaultLabel(name);
			const list = byTitle.get(base) ?? [];
			list.push({ entity: name, key, label });
			byTitle.set(base, list);
		}
	}
	const result = resolveCollisions(byTitle, ENTITY_HIERARCHY);
	overridesCache = result.overrides;
	reportCache = result.report;
	prepared = true;
	return reportCache;
}

// Sync lookup used by the pageTitle wrapper. Falls back to base when no
// override exists (or when prepareTitleResolution hasn't run).
export function finalTitle(key: string, base: string): string {
	return overridesCache.get(key) ?? base;
}
