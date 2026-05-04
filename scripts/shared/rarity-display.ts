// Wiki rendering for rarity tiers — colors, sort order, sortable table cells.
// Per-tier colors come from `RarityEntry.Color` in the dump so the wiki
// matches the in-game UI exactly. The ordering and the lowercased name list
// are local because the dump doesn't expose a tier rank.

import { lazyLoad } from './entity-registry';
import { readDump } from './dump';
import { rgbaToHex } from './format-utils';

// Power tier (Standard < Rare < Epic < Exotic < Oddity < Contraband). Used
// for two purposes:
//   - As `data-sort-value` on wiki sortable-table cells (`rarityCell`)
//   - As a stable comparator key for `loadRarities()` to sort the catalog
//     by power tier rather than alphabetically.
export const RARITY_ORDER: Record<string, number> = {
	Standard: 1,
	Rare: 2,
	Epic: 3,
	Exotic: 4,
	Oddity: 5,
	Contraband: 6
};

// Lowercased order used by `loadRarities()` (the dump stores rarity names
// lowercased; everywhere else has them title-cased).
export const RARITY_ORDER_LOWER: string[] = [
	'standard',
	'rare',
	'epic',
	'exotic',
	'oddity',
	'contraband'
];

// Build TitleCase → "#rrggbb" map from the dump's RarityEntry.Color values.
// Lazy-loaded once per process.
const getRarityColors = lazyLoad((): Record<string, string> => {
	const dump = readDump() as unknown as {
		rarities?: Record<string, { Name?: string; Color?: string }>;
	};
	const out: Record<string, string> = {};
	for (const r of Object.values(dump.rarities ?? {})) {
		if (!r.Name) continue;
		const titleCase = r.Name[0].toUpperCase() + r.Name.slice(1);
		const hex = rgbaToHex(r.Color);
		if (hex) out[titleCase] = hex;
	}
	return out;
});

// Returns the in-game color for a TitleCased rarity name (e.g. "Exotic").
// Returns undefined if the rarity isn't in the dump's catalog.
export function rarityColor(rarity: string): string | undefined {
	return getRarityColors()[rarity];
}

// Render a wiki-table cell *body* prefixed with `data-sort-value="N" | ` so
// MediaWiki's sortable plugin sorts by tier numerically while displaying the
// coloured rarity span. Insert as `|| ${rarityCell(...)}`.
export function rarityCell(rarity: string): string {
	const order = RARITY_ORDER[rarity] ?? 99;
	const color = rarityColor(rarity);
	const inner = color ? `<span style="color:${color}">${rarity}</span>` : rarity;
	return `data-sort-value="${order}" | ${inner}`;
}

// Title-Case the dump's lowercased rarity names: "exotic" → "Exotic".
export function rarityDisplay(name: string | undefined): string {
	if (!name) return '';
	return name[0].toUpperCase() + name.slice(1);
}
