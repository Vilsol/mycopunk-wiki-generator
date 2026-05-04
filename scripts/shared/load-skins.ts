// Skin entity: each playable cosmetic upgrade (Cosmetic UpgradeType) projects
// to a single Skin record. Composite identity is needed because skin Name and
// APIName collide across parents — `Factory` is a Scrapper character skin,
// an Accelerator gun skin, AND a Shocklance gun skin, each a separate dump
// row. The dump's Upgrade.ID is the only globally unique key.

import type { Upgrade, DSkin } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName, stripHtml } from './wiki-text';

export interface Skin {
	upgrade: Upgrade;
	skin: DSkin;
	// `ApplicableTo[].APIName` list — gear/character keys this skin renders on.
	// Multi-entry means the skin is universal (e.g. Gun Crab variants apply to
	// every gun). Empty is theoretically possible but never observed.
	parents: string[];
	// Human display names from `ApplicableTo[].Name` (with the trailing
	// "(Character)" / "(<Class>)" suffix stripped).
	parentDisplays: string[];
}

const SKIN_NAME_TEST_PATTERN = /^_test|\.[a-z]+$/;

function stripParens(name: string): string {
	return name.split(' (')[0].trim();
}

export function loadSkins(): Skin[] {
	const data = readDump() as unknown as { upgrades?: Record<string, Upgrade> };
	if (!data?.upgrades || typeof data.upgrades !== 'object') {
		throw new Error(`Invalid data.json shape: expected an 'upgrades' object`);
	}

	const out: Skin[] = [];
	for (const u of Object.values(data.upgrades)) {
		if (u.UpgradeType !== 'Cosmetic') continue;
		if (!u.Skin) continue;
		const name = stripHtml(u.Name ?? '').trim();
		// Filter unfinished/dev entries (e.g. `_test_final_v2.skinasset`).
		if (!name || SKIN_NAME_TEST_PATTERN.test(name)) continue;

		const applicable = u.ApplicableTo ?? [];
		const parents = applicable.map((a) => a.APIName ?? '').filter(Boolean);
		const parentDisplays = applicable.map((a) => stripParens(a.Name ?? '')).filter(Boolean);

		out.push({ upgrade: u, skin: u.Skin, parents, parentDisplays });
	}

	out.sort((a, b) => {
		const an = stripHtml(a.upgrade.Name ?? '');
		const bn = stripHtml(b.upgrade.Name ?? '');
		const c = an.localeCompare(bn);
		if (c) return c;
		return (a.parentDisplays[0] ?? '').localeCompare(b.parentDisplays[0] ?? '');
	});
	return out;
}

export function plainName(s: Skin): string {
	return stripHtml(s.upgrade.Name ?? '').trim();
}

// Cosmetic.APIName collides across parents (3× "Factory"), so the only
// globally-unique base for a filename is the dump ID.
export function safeFilename(s: Skin): string {
	return `skin_${s.upgrade.ID}`;
}

// "Scrapper Factory Skin" / "Universal Gun Crab - Eye Skin"
export function skinPageTitle(s: Skin): string {
	const name = plainName(s);
	if (s.parentDisplays.length === 1) return `${s.parentDisplays[0]} ${name} Skin`;
	if (s.parentDisplays.length > 1) return `${name} (Universal Skin)`;
	return `${name} Skin`;
}

// "Scrapper_Factory_Skin" / "Gun_Crab_-_Eye_Universal_Skin"
export function displayFilename(s: Skin): string {
	const name = plainName(s);
	const base =
		s.parentDisplays.length === 1
			? `${s.parentDisplays[0]}_${name}_Skin`
			: s.parentDisplays.length > 1
				? `${name}_Universal_Skin`
				: `${name}_Skin`;
	return normalizeWikiTitle(sanitizeAPIName(base));
}

// Per-variant filename. Single-parent skins encode the parent in
// `displayFilename` already (e.g. `Scrapper_Factory_Skin`), so the variant
// filename just appends the preset slug. Multi-parent (universal) skins
// share one `displayFilename` (`Constellation_Universal_Skin`) across all
// 12 gear renderings, so we MUST include the parent in the variant
// filename — otherwise every (parent, preset) pair would collapse to one
// file and only the last-written render persists on disk.
//
// Output formats:
//   `jpg`  — single frame still (used as the row thumbnail in skin tables).
//   `webp` — animated 360° rotation.
export function variantPreviewFilename(
	s: Skin,
	parent: string,
	preset: string,
	ext: 'webp' | 'jpg'
): string {
	const base = displayFilename(s);
	const presetSlug = normalizeWikiTitle(sanitizeAPIName(preset));
	const parentSlug = s.parents.length > 1 ? `${normalizeWikiTitle(sanitizeAPIName(parent))}_` : '';
	return `${base}_${parentSlug}${presetSlug}_Preview.${ext}`;
}
