// Upgrade-preset entity: loader, identification, catalog page for each
// `UpgradePreset` SO. Cross-refs every cosmetic upgrade whose
// `Skin.Modifiers[].Preset` references this preset.

import type { UpgradePresetEntry } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName, stripHtml } from '../wiki-text';
import { defineEntity, lazyLoad, loadFromDump } from '../entity-registry';
import { loadSkins, skinPageTitle, type Skin } from './skins';
import { buildModifiersTable, loadParentLookup, parentLink } from './skins';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export const loadUpgradePresets = loadFromDump<UpgradePresetEntry>({
	dumpKey: 'upgradePresets',
	sort: (a, b) => (a.Name ?? '').localeCompare(b.Name ?? '')
});

export function safeFilename(p: UpgradePresetEntry): string {
	return sanitizeAPIName(p.Name ?? '');
}

export function displayFilename(p: UpgradePresetEntry): string {
	return normalizeWikiTitle(sanitizeAPIName(`${p.Name}_Preset`));
}

// Match wiki convention used for directives ("<name> Mission Modifier"): a
// human-readable suffix avoids collisions with bare adjectives like "Topaz"
// that may have other uses.
export function presetPageTitle(p: UpgradePresetEntry): string {
	return `${p.Name} Skin Preset`;
}

// ─────────────────────────────────────────────────────────────────────────
// Inversion: preset name → skins that reference it.
// ─────────────────────────────────────────────────────────────────────────

export function loadSkinsByPreset(): Map<string, Skin[]> {
	const out = new Map<string, Skin[]>();
	for (const s of loadSkins()) {
		const seen = new Set<string>();
		for (const m of s.skin.Modifiers ?? []) {
			if (m.Type !== 'SkinUpgradeProperty_Preset') continue;
			const p = m.Preset ?? '';
			if (!p || seen.has(p)) continue;
			seen.add(p);
			const list = out.get(p) ?? [];
			list.push(s);
			out.set(p, list);
		}
	}
	for (const list of out.values()) {
		list.sort((a, b) =>
			stripHtml(a.upgrade.Name ?? '').localeCompare(stripHtml(b.upgrade.Name ?? ''))
		);
	}
	return out;
}

function buildUsedBySkinsTable(skins: Skin[]): string {
	if (skins.length === 0) return '';
	const lookup = loadParentLookup();
	const out = ['{| class="wikitable sortable"', '! Skin !! Parent !! Rarity'];
	// Dedupe by (skin page title, parent set) — multiple cosmetic upgrade IDs
	// can resolve to the same skin page (rarity dupes), and we don't want
	// "Mini Cannon Factory" rendered twice.
	const seen = new Set<string>();
	for (const s of skins) {
		const title = skinPageTitle(s);
		const display = stripHtml(s.upgrade.Name ?? '');
		const dedupKey = `${title}|${s.parents.join(',')}`;
		if (seen.has(dedupKey)) continue;
		seen.add(dedupKey);
		const parents = s.parents.map((p) => parentLink(p, lookup)).join(', ') || '—';
		out.push('|-');
		out.push(`| [[${title}|${display}]] || ${parents} || ${s.upgrade.Rarity ?? ''}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

interface ModifierRowable {
	Type: string;
	Chance?: number | null;
	[k: string]: unknown;
}

const getSkinsByPreset = lazyLoad(loadSkinsByPreset);
const getAllPresets = lazyLoad(() => new Map(loadUpgradePresets().map((p) => [p.Name, p])));

export function buildPresetContext(preset: UpgradePresetEntry): Record<string, unknown> {
	const skinsByPreset = getSkinsByPreset();
	const allPresets = getAllPresets();
	const usedBy = skinsByPreset.get(preset.Name) ?? [];
	return {
		name: escapeWikiText(preset.Name),
		pageTitle: presetPageTitle(preset),
		apiName: escapeWikiText(preset.Name),
		nameModifier: preset.OverrideNameModifier ?? '',
		nameModifierColor: preset.NameModifierColor ?? '',
		showNameInStats: preset.ShowNameInStats ? 'Yes' : 'No',
		modifierCount: (preset.Modifiers ?? []).length,
		usedByCount: usedBy.length,
		seoDescription: `${preset.Name} skin preset in Mycopunk — visual effect bundle applied to skins via SkinUpgradeProperty_Preset.`,
		modifiersSection: buildModifiersTable(
			preset.Modifiers as ModifierRowable[] | undefined,
			allPresets
		),
		hasModifiers: (preset.Modifiers ?? []).length > 0,
		usedBySection: buildUsedBySkinsTable(usedBy),
		hasUsedBy: usedBy.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<UpgradePresetEntry>({
	name: 'upgrade-presets',
	dumpKey: 'upgradePresets',
	loadItems: loadUpgradePresets,
	safeFilename,
	displayFilename,
	pageTitle: presetPageTitle,
	identLabel: (p) => p.Name,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'gallery', 'trivia', 'notes'],
		autoGenSections: ['modifiers', 'used by', 'description', 'overview'],
		infoboxTemplateName: 'Infobox skin preset'
	},
	templateName: 'upgrade-preset-source.wiki',
	skeletonTemplateName: 'upgrade-preset-skeleton.wiki',
	contextBuilder: buildPresetContext
});

export function loadPresetGenerationData() {
	return {
		presets: loadUpgradePresets(),
		skinsByPreset: getSkinsByPreset(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
