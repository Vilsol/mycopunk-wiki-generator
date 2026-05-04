// Directive entity (wiki calls them "Mission Modifiers").
//
// Each Directive has a Name + Description, a TierWeights table (per-difficulty
// selection probability), one or more Property clauses, and AdditionalRewards
// granted on completion. Pages use the wiki's existing "Mission Modifier"
// suffix convention.

import type { Directive, DirectivePropertyEntry, TierWeights } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import {
	loadDirectives,
	loadDirectiveGroups,
	displayFilename,
	directivePageTitle,
	safeFilename
} from '../load-directives';
import { loadUpgradesByID } from './characters';
import { fmtPct } from './format-utils';
import { buildRewardsTable } from './reward-utils';
import type { EntityClassifierConfig } from '../upload-pipeline';

export { loadDirectives, loadDirectiveGroups, displayFilename, directivePageTitle, safeFilename };

// ─────────────────────────────────────────────────────────────────────────
// Tier weights
// ─────────────────────────────────────────────────────────────────────────

function buildTierWeightsTable(weights: TierWeights | undefined): string {
	if (!weights) return '';
	const rows: [string, number | undefined][] = [
		['Tier 1', weights.Tier1],
		['Tier 2', weights.Tier2],
		['Tier 3', weights.Tier3],
		['Tier 4', weights.Tier4]
	];
	const present = rows.filter(([, v]) => v !== undefined);
	if (present.length === 0) return '';
	const out = ['{| class="wikitable"', '! Tier !! Weight'];
	for (const [label, value] of present) {
		out.push('|-');
		out.push(`| ${label} || ${value}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Properties (clauses)
// ─────────────────────────────────────────────────────────────────────────

function describeProperty(p: DirectivePropertyEntry): string {
	const label =
		p.Label ||
		p.Type.replace(/^DirectiveProperty_/, '')
			.replace(/([A-Z])/g, ' $1')
			.trim();
	const desc = stripHtml(p.Description ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	const raw = p.Raw as Record<string, unknown> | undefined;
	const kills = raw?.kills as { min?: number; max?: number } | undefined;
	const range =
		kills?.min !== undefined && kills.max !== undefined ? ` (${kills.min}–${kills.max})` : '';
	return `'''${label}'''${range}${desc ? ` — ${desc}` : ''}`;
}

function buildPropertiesSection(properties: DirectivePropertyEntry[] | undefined): string {
	if (!properties || properties.length === 0) return '';
	const out: string[] = [];
	for (const p of properties) {
		out.push(`* ${describeProperty(p)}`);
	}
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Description rich-text fixup — game text contains `<b><></b>` placeholders
// where a gear/element name would appear at runtime (since the directive isn't
// bound to a specific gear yet at definition time). Render those as a
// `[gear/element]` italicised stub so the description remains readable.
// ─────────────────────────────────────────────────────────────────────────

function describeDirectiveText(raw: string | undefined): string {
	if (!raw) return '';
	let out = raw.replace(/<b><><\/b>/g, "''[varies]''");
	out = stripHtml(out);
	return out.replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Variants table — surfaces stat differences between same-named directive
// records. Mirrors the enemies pattern: each name maps to one wiki page;
// variants show as a comparison table below the canonical record's stats.
// ─────────────────────────────────────────────────────────────────────────

function tierPctOrEmpty(v: number | undefined): string {
	if (v === undefined) return '—';
	if (v === 0) return '0%';
	return fmtPct(v);
}

function flag(v: unknown): string {
	if (v === true) return 'Yes';
	if (v === false) return 'No';
	return '—';
}

// Some directive properties carry refs like `container.@ref` that point at a
// missionContainer (e.g. "Overtime Assignment"). When present, this disambiguates
// otherwise-identical variants.
function containerRef(p: DirectivePropertyEntry | undefined): string {
	const raw = p?.Raw as Record<string, unknown> | undefined;
	const c = raw?.container as { '@ref'?: string } | undefined;
	if (!c?.['@ref']) return '';
	return c['@ref'].replace(/^missionContainer:/, '');
}

function buildDirectiveVariantsTable(variants: Directive[]): string {
	// Build display rows, dedupe on visible content (two records may differ in
	// fields we don't show — collapse those just like the enemies table does).
	const seen = new Set<string>();
	const rows: string[] = [];
	for (const v of variants) {
		const tw = v.TierWeights ?? {};
		const p = v.Properties?.[0];
		const raw = (p?.Raw as Record<string, unknown> | undefined) ?? {};
		const cells = [
			String(v.ID),
			tierPctOrEmpty(tw.Tier1),
			tierPctOrEmpty(tw.Tier2),
			tierPctOrEmpty(tw.Tier3),
			tierPctOrEmpty(tw.Tier4),
			flag(raw.requireCharacter),
			flag(raw.randomRegion),
			containerRef(p) || '—'
		];
		const row = `| ${cells.join(' || ')}`;
		if (seen.has(row)) continue;
		seen.add(row);
		rows.push(row);
	}
	if (rows.length < 2) return '';
	const out = [
		'{| class="wikitable sortable"',
		'! ID !! Tier 1 !! Tier 2 !! Tier 3 !! Tier 4 !! Req. Char. !! Random Region !! Container'
	];
	for (const r of rows) {
		out.push('|-');
		out.push(r);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildDirectiveContext(
	d: Directive,
	upgradesByID: Map<string, GenericGunUpgrade>,
	variants: Directive[] = [d]
): Record<string, unknown> {
	const tierTable = buildTierWeightsTable(d.TierWeights);
	const propertiesSection = buildPropertiesSection(d.Properties);
	const rewardsSection = buildRewardsTable(d.AdditionalRewards, { upgradesByID });
	const descText = describeDirectiveText(d.Description);
	const variantsSection = buildDirectiveVariantsTable(variants);

	// Sum of TierWeights — surface as a quick "rarity" hint. Higher = more
	// likely to appear in the random pool.
	const totalWeight = d.TierWeights
		? (d.TierWeights.Tier1 ?? 0) +
			(d.TierWeights.Tier2 ?? 0) +
			(d.TierWeights.Tier3 ?? 0) +
			(d.TierWeights.Tier4 ?? 0)
		: 0;

	return {
		name: escapeWikiText(d.Name ?? `directive_${d.ID}`),
		pageTitle: directivePageTitle(d),
		apiName: String(d.ID),
		descriptionText: descText,
		seoDescription: descText
			? `${d.Name ?? ''} mission modifier — ${descText}`.slice(0, 280)
			: `${d.Name ?? `directive ${d.ID}`} mission modifier in Mycopunk.`,
		canBeChosen: d.CanBeChosen ? 'Yes' : 'No',
		canBeChosenRaw: d.CanBeChosen,
		totalWeight: fmtPct(totalWeight / 4),
		icon: `${displayFilename(d)}_Icon.png`,
		tierWeightsSection: tierTable,
		hasTierWeights: tierTable.length > 0,
		propertiesSection,
		hasProperties: propertiesSection.length > 0,
		variantsSection,
		hasVariants: variantsSection.length > 0,
		rewardsSection,
		hasRewards: rewardsSection.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const DIRECTIVE_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history', 'bugs'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set([
		'description',
		'effects',
		'properties',
		'tier weights',
		'variants',
		'rewards',
		'overview'
	]),
	infoboxStripPattern: /\{\{Infobox (mission modifier|directive)[\s\S]*?\}\}/g
};

export function loadDirectiveGenerationData() {
	return {
		directives: loadDirectives(),
		upgradesByID: loadUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
