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
