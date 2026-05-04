// Upgrade-preset entity: catalog page for each `UpgradePreset` SO. Cross-refs
// every cosmetic upgrade whose `Skin.Modifiers[].Preset` references this preset.

import type { UpgradePresetEntry } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import {
	loadUpgradePresets,
	displayFilename,
	presetPageTitle,
	safeFilename
} from '../load-upgrade-presets';
import { loadSkins, skinPageTitle, type Skin } from '../load-skins';
import { buildModifiersTable, loadParentLookup, parentLink } from './skins';
import type { EntityClassifierConfig } from '../upload-pipeline';

export { loadUpgradePresets, displayFilename, presetPageTitle, safeFilename };

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

export function buildPresetContext(
	preset: UpgradePresetEntry,
	skinsByPreset: Map<string, Skin[]>,
	allPresets: Map<string, UpgradePresetEntry>
): Record<string, unknown> {
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
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const PRESET_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(['lore', 'gallery', 'trivia', 'notes'].map((s) => s.toLowerCase())),
	autoGenSections: new Set(['modifiers', 'used by', 'description', 'overview']),
	infoboxStripPattern: /\{\{Infobox skin preset[\s\S]*?\}\}/g
};

export function loadPresetGenerationData() {
	return {
		presets: loadUpgradePresets(),
		skinsByPreset: loadSkinsByPreset(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
