// Skin entity: loader, identification, per-cosmetic-upgrade page with full
// Skin block (modifiers, variants gallery, name modifiers list, parent
// backlinks, preset references), registry definition.

import type { Upgrade, DSkin, UpgradePresetEntry } from '../data/schema.d';
import { readDump } from '../dump';
import {
	descriptionToWiki,
	escapeWikiText,
	normalizeWikiTitle,
	sanitizeAPIName,
	stripHtml
} from '../wiki-text';
import { defineEntity } from '../entity-registry';
import { presetPageTitle } from './upgrade-presets';
import { loadGears, gearPageTitle } from './gears';
import { loadCharacters, characterPageTitle } from './characters';
import { fmtPct, rgbaToHex } from '../format-utils';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export interface Skin {
	upgrade: Upgrade;
	skin: DSkin;
	parents: string[];
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

export function skinPageTitle(s: Skin): string {
	const name = plainName(s);
	if (s.parentDisplays.length === 1) return `${s.parentDisplays[0]} ${name} Skin`;
	if (s.parentDisplays.length > 1) return `${name} (Universal Skin)`;
	return `${name} Skin`;
}

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
// `displayFilename` already; multi-parent (universal) skins share one
// `displayFilename` across all gear renderings, so we MUST include the
// parent in the variant filename — otherwise every (parent, preset) pair
// would collapse to one file.
//   `jpg`  — single frame still.
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

// ─────────────────────────────────────────────────────────────────────────
// Parent-link resolution. `Skin.Previews` keys and `Skin.parents` are API
// names (e.g. `accelerator`, `Scrapper`) which aren't valid wiki page
// titles for guns. Build a single lookup from the gears + characters
// catalogs so both the skin variants gallery and the preset used-by table
// can render `[[<wiki page title>|<display name>]]`.
// ─────────────────────────────────────────────────────────────────────────

interface ParentEntry {
	pageTitle: string;
	display: string;
}

let parentLookupCache: Map<string, ParentEntry> | null = null;

export function loadParentLookup(): Map<string, ParentEntry> {
	if (parentLookupCache) return parentLookupCache;
	const out = new Map<string, ParentEntry>();
	for (const c of loadCharacters()) {
		if (c.APIName)
			out.set(c.APIName, { pageTitle: characterPageTitle(c), display: c.Name ?? c.APIName });
	}
	for (const g of loadGears()) {
		if (g.APIName)
			out.set(g.APIName, { pageTitle: gearPageTitle(g), display: g.Name ?? g.APIName });
	}
	parentLookupCache = out;
	return out;
}

export function parentLink(apiName: string, lookup?: Map<string, ParentEntry>): string {
	const map = lookup ?? loadParentLookup();
	const e = map.get(apiName);
	if (!e) return apiName; // fall back to raw key when unmapped
	if (e.pageTitle === e.display) return `[[${e.pageTitle}]]`;
	return `[[${e.pageTitle}|${e.display}]]`;
}

// ─────────────────────────────────────────────────────────────────────────
// Preset cross-ref: SkinUpgradeProperty_Preset entries → preset entry.
// ─────────────────────────────────────────────────────────────────────────

function loadPresetMap(): Map<string, UpgradePresetEntry> {
	const data = readDump() as unknown as {
		upgradePresets?: Record<string, UpgradePresetEntry>;
	};
	const out = new Map<string, UpgradePresetEntry>();
	for (const p of Object.values(data.upgradePresets ?? {})) {
		if (p.Name) out.set(p.Name, p);
	}
	return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Modifier rendering — collapse `Skin.Modifiers[]` into a wiki table row.
// Each modifier subtype has a different field family; `summarizeModifier`
// returns a single human-readable cell.
// ─────────────────────────────────────────────────────────────────────────

interface ModifierRowable {
	Type: string;
	Chance?: number | null;
	[k: string]: unknown;
}

function shortType(type: string): string {
	return type.replace(/^SkinUpgradeProperty_/, '');
}

function colorChip(rgba: string | undefined): string {
	const hex = rgbaToHex(rgba);
	if (!hex) return '';
	return `<span style="display:inline-block;width:12px;height:12px;background:${hex};border:1px solid #444;vertical-align:middle;"></span> <code>${hex}</code>`;
}

function summarizeModifier(m: ModifierRowable, presets: Map<string, UpgradePresetEntry>): string {
	switch (m.Type) {
		case 'SkinUpgradeProperty_Trim':
			return [
				m.TrimName ? `'''${stripHtml(String(m.TrimName))}'''` : '',
				colorChip(m.TrimColor as string | undefined)
			]
				.filter(Boolean)
				.join(' ');
		case 'SkinUpgradeProperty_Preset': {
			const presetName = String(m.Preset ?? '');
			if (!presetName) return '';
			const target = presets.get(presetName);
			if (target) return `[[${presetPageTitle(target)}|${presetName}]]`;
			return `<code>${presetName}</code>`;
		}
		case 'SkinUpgradeProperty_Texture': {
			const find = String(m.TextureFind ?? '');
			const main = String(m.TextureMain ?? '');
			return [find && `find: <code>${find}</code>`, main && `main: <code>${main}</code>`]
				.filter(Boolean)
				.join(' • ');
		}
		case 'SkinUpgradeProperty_Color':
			return colorChip(m.ColorPrimary as string | undefined);
		case 'SkinUpgradeProperty_Emissive':
			return [
				m.EmissiveStatName ? `'''${stripHtml(String(m.EmissiveStatName))}'''` : '',
				colorChip(m.EmissiveColor as string | undefined)
			]
				.filter(Boolean)
				.join(' ');
		case 'SkinUpgradeProperty_Neon': {
			const channels: string[] = [];
			for (const [k, label] of [
				['NeonRed', 'R'],
				['NeonGreen', 'G'],
				['NeonBlue', 'B'],
				['NeonYellow', 'Y'],
				['NeonMagenta', 'M']
			] as const) {
				const v = m[k];
				if (typeof v === 'number' && v > 0) channels.push(`${label}:${v.toFixed(2)}`);
			}
			return channels.join(' ');
		}
		case 'SkinUpgradeProperty_Chroma':
			return `sun: ${m.ChromaSunBrightness ?? 0}, shadow: ${m.ChromaShadowBrightness ?? 0}`;
		case 'SkinUpgradeProperty_Contrast':
			return `contrast: ${m.Contrast ?? 0}`;
		case 'SkinUpgradeProperty_Overlay': {
			const tex = String(m.OverlayTexture ?? '');
			return tex ? `<code>${tex}</code>` : '';
		}
		case 'SkinUpgradeProperty_TrickOrTreat':
			return `${colorChip(m.TrickColor as string | undefined)} → ${colorChip(m.TreatColor as string | undefined)}`;
		case 'SkinUpgradeProperty_Infection':
			return `scale: ${m.InfectionScale ?? 0}`;
		case 'SkinUpgradeProperty_GunCrab':
		case 'SkinUpgradeProperty_GunCrab_List': {
			const meshes = (m.CrabMeshes as string[] | undefined) ?? [];
			const model = String(m.CrabModel ?? '');
			if (meshes.length > 0)
				return `pool of ${meshes.length} mesh${meshes.length === 1 ? '' : 'es'}`;
			return model ? `<code>${model}</code>` : '';
		}
		case 'SkinUpgradeProperty_VFXCrab':
			return m.VfxCrabName ? `'''${stripHtml(String(m.VfxCrabName))}'''` : '';
		case 'SkinUpgradeProperty_CharacterModel':
			return 'replaces character mesh';
		case 'SkinUpgradeProperty_VFXCustomProp':
			return m.VfxCustomPropName ? `<code>${m.VfxCustomPropName}</code>` : '';
		case 'SkinUpgradeProperty_ContrastRange':
			return m.ContrastRangeLabel ? `'''${stripHtml(String(m.ContrastRangeLabel))}'''` : '';
		default:
			return '';
	}
}

export function buildModifiersTable(
	mods: ModifierRowable[] | undefined,
	presets: Map<string, UpgradePresetEntry>
): string {
	if (!mods || mods.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Type !! Chance !! Detail'];
	for (const m of mods) {
		const chance = typeof m.Chance === 'number' ? fmtPct(m.Chance) : '—';
		const detail = summarizeModifier(m, presets);
		out.push('|-');
		out.push(`| <code>${shortType(m.Type)}</code> || ${chance} || ${detail || '—'}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Variants gallery — one row per (parent, preset) preview entry.
//
// The rotation column emits a raw <img> tag instead of [[File:…webp]]
// because Miraheze's animated-WebP thumbnailer produces a degenerate 1×1
// thumbnail (ImageMagick lacks `-coalesce` on the image scaler). The wiki
// permits raw <img> via wgAllowImageTag/wgRawHtml, so we hotwire the
// browser to fetch the original asset directly via Special:Redirect/file.
// The still column keeps the wikitext form — jpg thumbnailing works fine.
// ─────────────────────────────────────────────────────────────────────────

const WIKI_FILE_REDIRECT = 'https://mycopunk.miraheze.org/wiki/Special:Redirect/file/';

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildVariantsTable(s: Skin): string {
	const previews = s.skin.Previews ?? {};
	const parents = Object.keys(previews);
	if (parents.length === 0) return '';
	const lookup = loadParentLookup();

	const rows: string[] = [];
	for (const parent of parents) {
		const presets = Object.keys(previews[parent] ?? {}).sort((a, b) => {
			// "base" first, then alphabetical.
			if (a === 'base') return -1;
			if (b === 'base') return 1;
			return a.localeCompare(b);
		});
		for (const preset of presets) {
			const stillFile = variantPreviewFilename(s, parent, preset, 'jpg');
			const animFile = variantPreviewFilename(s, parent, preset, 'webp');
			const presetLabel = preset === 'base' ? 'Base' : preset.replace(/_/g, ' ');
			const still = `[[File:${stillFile}|240px|alt=${presetLabel} preview]]`;
			const animSrc = `${WIKI_FILE_REDIRECT}${encodeURIComponent(animFile)}`;
			const animAlt = escapeAttr(`${presetLabel} 360° rotation`);
			const anim = `<img src="${animSrc}" width="240" height="240" alt="${animAlt}" loading="lazy" />`;
			rows.push('|-');
			rows.push(`| ${parentLink(parent, lookup)} || ${presetLabel} || ${still} || ${anim}`);
		}
	}
	if (rows.length === 0) return '';

	return [
		'{| class="wikitable sortable"',
		'! Parent !! Variant !! Still !! Rotation',
		...rows,
		'|}'
	].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Name-modifiers codex list. Renders the deterministic seed-sweep names as a
// bulleted list since they're free-form.
// ─────────────────────────────────────────────────────────────────────────

export function buildNameModifiersList(modifiers: string[] | undefined): string {
	if (!modifiers || modifiers.length === 0) return '';
	return modifiers.map((m) => `* ${escapeWikiText(m)}`).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Flag chips
// ─────────────────────────────────────────────────────────────────────────

function flagChips(skin: Skin['skin']): string {
	const flags: string[] = [];
	if (skin.HasVfx) flags.push('VFX');
	if (skin.HasCrab) flags.push('Crab');
	if (skin.HasCharacterModel) flags.push('Custom Model');
	if (skin.OverridesPattern) flags.push('Overrides Pattern');
	if (skin.ColorIcon) flags.push('Color Icon');
	if (skin.ChangeHueIfNoModifiersApplied) flags.push('Hue Fallback');
	return flags.join(', ');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildSkinContext(s: Skin): Record<string, unknown> {
	const presets = loadPresetMap();
	const name = plainName(s);
	const u = s.upgrade;

	const parentLinks = s.parentDisplays.map((p) => `[[${p}]]`).join(', ');

	const previewSlugs = Object.values(s.skin.Previews ?? {}).flatMap((m) => Object.keys(m));
	const variantCount = previewSlugs.length;

	const description = descriptionToWiki(u.Description);

	return {
		name: escapeWikiText(name),
		pageTitle: skinPageTitle(s),
		apiName: escapeWikiText(u.APIName ?? ''),
		dumpId: escapeWikiText(String(u.ID ?? '')),
		parentLinks,
		parentCount: s.parents.length,
		isUniversal: s.parents.length > 1,
		rarity: u.Rarity ?? '',
		colorHex: rgbaToHex(u.Color),
		baseSkin: s.skin.BaseSkin ? escapeWikiText(s.skin.BaseSkin) : '',
		flags: flagChips(s.skin),
		variantCount,
		descriptionText: description,
		seoDescription: stripHtml(u.Description ?? `${name} skin in Mycopunk.`).slice(0, 280),
		modifiersSection: buildModifiersTable(
			s.skin.Modifiers as ModifierRowable[] | undefined,
			presets
		),
		hasModifiers: (s.skin.Modifiers ?? []).length > 0,
		variantsSection: buildVariantsTable(s),
		hasVariants: variantCount > 0,
		nameModifiersSection: buildNameModifiersList(s.skin.NameModifiers),
		hasNameModifiers: (s.skin.NameModifiers ?? []).length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Skin>({
	name: 'skins',
	dumpKey: 'upgrades', // skins live under the upgrades map; loader filters
	loadItems: loadSkins,
	safeFilename,
	displayFilename,
	pageTitle: skinPageTitle,
	identLabel: (s) => `skin_${s.upgrade.ID}`,
	infoboxDescription: (s) => s.upgrade.Description ?? '',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'gallery', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['modifiers', 'variants', 'name modifiers', 'description', 'overview'],
		// Strip both "Infobox skin" and "Infobox skin preset" — but only "skin",
		// not "skin preset" (those go on preset pages, not skin pages).
		infoboxStripPattern: /\{\{Infobox skin(?! preset)[\s\S]*?\}\}/g
	},
	templateName: 'skin-source.wiki',
	skeletonTemplateName: 'skin-skeleton.wiki',
	contextBuilder: buildSkinContext
	// Skins don't have icons — variant previews are uploaded by
	// `upload-skin-previews.ts` and aren't part of the standard fileTypes
	// flow.
});

export function loadSkinGenerationData() {
	return {
		skins: loadSkins(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
