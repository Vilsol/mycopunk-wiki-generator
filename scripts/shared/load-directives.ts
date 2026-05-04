import type { Directive } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

function variantScore(d: Directive): number {
	let s = 0;
	if ((d.AdditionalRewards?.length ?? 0) > 0) s += 100;
	if (d.CanBeChosen) s += 10;
	return s;
}

// Group directives by Name. The dump has tier/region duplicates (5× "Mission
// Directive", 5× "Ouroboros Operation", etc. — same pattern as Brute enemies).
// Within a group, the canonical entry is the highest-scoring one; the rest
// surface in a Variants table on the page.
export function loadDirectiveGroups(): Map<string, Directive[]> {
	const data = readDump() as unknown as { directives?: Record<string, Directive> };
	if (!data?.directives || typeof data.directives !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'directives' property`);
	}
	const groups = new Map<string, Directive[]>();
	for (const d of Object.values(data.directives)) {
		const name = (d.Name ?? '').trim();
		if (!name) continue;
		const list = groups.get(name) ?? [];
		list.push(d);
		groups.set(name, list);
	}
	for (const list of groups.values()) {
		list.sort((a, b) => variantScore(b) - variantScore(a));
	}
	return groups;
}

export function loadDirectives(): Directive[] {
	// Canonical entry per name = the first (richest) of each group.
	return [...loadDirectiveGroups().values()]
		.map((variants) => variants[0])
		.sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

export function safeFilename(d: Directive): string {
	if (!d.Name || !/[a-zA-Z0-9]/.test(d.Name)) return `directive_${d.ID}`;
	return sanitizeAPIName(d.Name);
}

export function displayFilename(d: Directive): string {
	const name = d.Name || `directive_${d.ID}`;
	return normalizeWikiTitle(sanitizeAPIName(name));
}

// Wiki uses "<Name> Mission Modifier" — there are 35 existing pages with this
// suffix (e.g. "Bullet Hell Mission Modifier"). We follow the convention so
// auto-generated pages slot in alongside curator content.
export function directivePageTitle(d: Directive): string {
	return `${d.Name ?? `directive_${d.ID}`} Mission Modifier`;
}
