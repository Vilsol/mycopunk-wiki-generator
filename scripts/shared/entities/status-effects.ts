// Status Effect entity: loader, filename helpers, page title, context builder,
// and registry definition. Single source of truth for everything per-entity.

import type { StatusEffect } from '../data/schema.d';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName, stripHtml } from '../wiki-text';
import { defaultIconFileType, defineEntity, loadFromDump } from '../entity-registry';
import { isColliding, STATUS_EFFECT_SUFFIX } from '../cross-entity-collisions';
import { rgbaToHex } from '../format-utils';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

// Skip `el_normal` — placeholder "no element", not a real status. Other
// entries (immune, yeuco) are kept; Tuning section is gated downstream.
export const loadStatusEffects = loadFromDump<StatusEffect>({
	dumpKey: 'statusEffects',
	filter: (e) => e.ID !== 'el_normal'
});

export function safeFilename(effect: StatusEffect): string {
	return sanitizeAPIName(effect.ID);
}

export function displayFilename(effect: StatusEffect): string {
	if (!effect.Name || !/[a-zA-Z0-9]/.test(effect.Name)) return sanitizeAPIName(effect.ID);
	const base = normalizeWikiTitle(sanitizeAPIName(effect.Name));
	return isColliding(effect.Name) ? `${base}${STATUS_EFFECT_SUFFIX.filenameSuffix}` : base;
}

export function statusEffectPageTitle(effect: StatusEffect): string {
	const name = effect.Name ?? effect.ID;
	return isColliding(name) ? `${name}${STATUS_EFFECT_SUFFIX.titleSuffix}` : name;
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

function buildTuningSection(effect: StatusEffect): string {
	const t = effect.Tuning;
	if (!t) return '';
	const rows: [string, string][] = [];
	if (t.DamageMultiplier !== undefined) rows.push(['Damage Multiplier', `×${t.DamageMultiplier}`]);
	if (t.FullSaturationLifetime !== undefined)
		rows.push(['Full Saturation Lifetime (s)', String(t.FullSaturationLifetime)]);
	if (t.DecayDelay !== undefined) rows.push(['Decay Delay (s)', String(t.DecayDelay)]);
	if (t.DecaySpeed !== undefined) rows.push(['Decay Speed (/s)', String(t.DecaySpeed)]);
	if (rows.length === 0) return '';
	const out = ['{| class="wikitable"', '! Tuning !! Value'];
	for (const [label, value] of rows) {
		out.push('|-');
		out.push(`| ${label} || ${value}`);
	}
	out.push('|}');
	return out.join('\n');
}

export function buildStatusEffectContext(effect: StatusEffect): Record<string, unknown> {
	const name = stripHtml(effect.Name ?? effect.ID);
	const colorHex = rgbaToHex(effect.IconColor) || rgbaToHex(effect.TextColor);
	return {
		name: escapeWikiText(name),
		pageTitle: statusEffectPageTitle(effect),
		apiName: escapeWikiText(effect.ID),
		colorHex,
		verbName: effect.VerbName ?? '',
		pastVerbName: effect.PastVerbName ?? '',
		stopsRegen: effect.StopsHealthRegeneration ? 'Yes' : 'No',
		numStages: effect.NumStages ?? 0,
		minStage: effect.MinStageValue ?? 0,
		hasTuning: effect.Tuning != null,
		tuningSection: buildTuningSection(effect),
		icon: `${displayFilename(effect)}_Icon.png`,
		seoDescription:
			effect.VerbName && effect.VerbName !== name
				? `${name}: ${effect.VerbName.toLowerCase()}s targets in Mycopunk.`
				: `${name} status effect in Mycopunk.`
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<StatusEffect>({
	name: 'status-effects',
	dumpKey: 'statusEffects',
	loadItems: loadStatusEffects,
	safeFilename,
	displayFilename,
	pageTitle: statusEffectPageTitle,
	identLabel: (e) => `${e.ID} (${e.Name ?? '?'})`,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: [
			'lore',
			'mechanics',
			'strategy',
			'trivia',
			'notes',
			'bugs',
			'patch history'
		],
		autoGenSections: ['tuning', 'visuals', 'overview'],
		infoboxTemplateName: 'Infobox status effect'
	},
	templateName: 'status-effect-source.wiki',
	skeletonTemplateName: 'status-effect-skeleton.wiki',
	contextBuilder: buildStatusEffectContext,
	fileTypes: [
		defaultIconFileType<StatusEffect>({
			displayFilename,
			prettyName: (e) => e.Name ?? e.ID,
			categoryName: 'Status Effect Icons',
			entityLabelSingular: 'status effect'
		})
	],
	icon: {
		getTexture: (e) => e.Icon ?? null
	}
});
