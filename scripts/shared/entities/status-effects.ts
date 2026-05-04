// Status Effect entity: formatter context, color parsing for hex chips,
// Tuning table extraction, classifier config.

import type { StatusEffect } from '../data/schema.d';
import { escapeWikiText, stripHtml } from '../wiki-text';
import {
	loadStatusEffects,
	displayFilename,
	safeFilename,
	statusEffectPageTitle
} from '../load-status-effects';
import type { EntityClassifierConfig } from '../upload-pipeline';
import { rgbaToHex } from './format-utils';

export { loadStatusEffects, displayFilename, safeFilename, statusEffectPageTitle };

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

// Classifier config — every section on the host page is curator-territory
// after the bot fills the infobox/tuning. Pages have no Acquisition.
export const STATUS_EFFECT_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'mechanics', 'strategy', 'trivia', 'notes', 'bugs', 'patch history'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set(['tuning', 'visuals', 'overview']),
	infoboxStripPattern: /\{\{Infobox status effect[\s\S]*?\}\}/g
};
