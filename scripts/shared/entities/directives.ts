// Directive entity (wiki calls them "Mission Modifiers").
//
// Each Directive has a Name + Description, a TierWeights table (per-difficulty
// selection probability), one or more Property clauses, and AdditionalRewards
// granted on completion. Pages use the wiki's existing "Mission Modifier"
// suffix convention.

import type { Directive, DirectivePropertyEntry, TierWeights } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName, stripHtml } from '../wiki-text';
import { defineEntity, lazyLoad } from '../entity-registry';
import { loadUpgradesByID } from './characters';
import { fmtPct } from '../format-utils';
import { buildRewardsTable } from '../reward-utils';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

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
// Variants table
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

function containerRef(p: DirectivePropertyEntry | undefined): string {
	const raw = p?.Raw as Record<string, unknown> | undefined;
	const c = raw?.container as { '@ref'?: string } | undefined;
	if (!c?.['@ref']) return '';
	return c['@ref'].replace(/^missionContainer:/, '');
}

function buildDirectiveVariantsTable(variants: Directive[]): string {
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

const getUpgradesByID = lazyLoad(loadUpgradesByID);
const getGroups = lazyLoad(loadDirectiveGroups);

export function buildDirectiveContext(d: Directive): Record<string, unknown> {
	const upgradesByID = getUpgradesByID();
	const variants = getGroups().get(d.Name as string) ?? [d];

	const tierTable = buildTierWeightsTable(d.TierWeights);
	const propertiesSection = buildPropertiesSection(d.Properties);
	const rewardsSection = buildRewardsTable(d.AdditionalRewards, { upgradesByID });
	const descText = describeDirectiveText(d.Description);
	const variantsSection = buildDirectiveVariantsTable(variants);

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

export function loadDirectiveGenerationData() {
	return {
		directives: loadDirectives(),
		upgradesByID: getUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Directive>({
	name: 'directives',
	dumpKey: 'directives',
	loadItems: loadDirectives,
	safeFilename,
	displayFilename,
	pageTitle: directivePageTitle,
	identLabel: (d) => `${d.Name} (ID: ${d.ID})`,
	infoboxDescription: (d) => d.Description ?? '',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history', 'bugs'],
		autoGenSections: [
			'description',
			'effects',
			'properties',
			'tier weights',
			'variants',
			'rewards',
			'overview'
		],
		// Wiki templates use both "Infobox mission modifier" (preferred) and
		// "Infobox directive" (legacy). Strip both forms.
		infoboxStripPattern: /\{\{Infobox (mission modifier|directive)[\s\S]*?\}\}/g
	},
	templateName: 'directive-source.wiki',
	skeletonTemplateName: 'directive-skeleton.wiki',
	contextBuilder: buildDirectiveContext,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (d) => `${displayFilename(d)}_Icon.png`,
			targetFilename: (d) => `${displayFilename(d)}_Icon.png`,
			description: (d) =>
				[
					`'''${d.Name}'''`,
					'',
					`Icon for the ${d.Name} mission modifier in Mycopunk.`,
					'',
					`[[Category:Mission Modifier Icons]]`
				].join('\n')
		}
	],
	icon: {
		getTexture: (d) => d.Icon ?? null
	}
});
