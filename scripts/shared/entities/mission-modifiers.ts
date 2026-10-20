// Mission modifier entity: per-modifier infobox, description, incompatibilities
// and where the modifier shows up (random mission pool, Overtime rotation).
//
// Not to be confused with the `directives` entity, which the wiki also calls
// "Mission Modifiers" — both share the `<Name> Mission Modifier` title scheme
// and the `Infobox mission modifier` template.

import type { MissionEntry, MissionModifier } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity, lazyLoad } from '../entity-registry';
import { fmtNum, fmtPct } from '../format-utils';
import {
	loadModifierGroups,
	loadModifierWeights,
	loadMissionModifiers,
	loadOvertime,
	modifierName
} from '../load-mission-modifiers';
import { finalTitle, titleKey } from '../title-resolver';
import {
	descriptionToWiki,
	escapeWikiText,
	normalizeWikiTitle,
	plainText,
	sanitizeAPIName
} from '../wiki-text';
import { missionPageTitle, safeFilename as missionSafeFilename } from './missions';

// ─────────────────────────────────────────────────────────────────────────
// Identification
// ─────────────────────────────────────────────────────────────────────────

export function safeFilename(m: MissionModifier): string {
	return sanitizeAPIName(modifierName(m));
}

export function displayFilename(m: MissionModifier): string {
	return normalizeWikiTitle(safeFilename(m));
}

// Curators title the redacted one "//ERROR REDACTED// Mission Modifier".
export function modifierPageTitle(m: MissionModifier): string {
	return `${plainText(modifierName(m)).replace(/_/g, ' ')} Mission Modifier`;
}

// Collision-resolved title, for other pages to link to.
export function modifierFinalTitle(m: MissionModifier): string {
	return finalTitle(titleKey('mission-modifiers', safeFilename(m)), modifierPageTitle(m));
}

export function modifierLink(m: MissionModifier): string {
	const label = escapeWikiText(plainText(modifierName(m)).replace(/_/g, ' '));
	return `[[${modifierFinalTitle(m)}|${label}]]`;
}

// Canonical modifier for any modifier ID (variants resolve to their group head).
export const getModifiersByID = lazyLoad(() => {
	const byID = new Map<number, MissionModifier>();
	for (const variants of loadModifierGroups().values()) {
		for (const v of variants) byID.set(v.ID, variants[0]);
	}
	return byID;
});

// ─────────────────────────────────────────────────────────────────────────
// Shared formatting
// ─────────────────────────────────────────────────────────────────────────

export function formatXP(xp: number | undefined): string {
	return xp === undefined ? '' : `×${fmtNum(xp)}`;
}

export function formatDate(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

const getMissionsByKey = lazyLoad(
	() => (readDump() as unknown as { missions: Record<string, MissionEntry> }).missions
);

function missionLink(key: string): string {
	const m = getMissionsByKey()[key];
	if (!m) return escapeWikiText(key);
	const title = finalTitle(titleKey('missions', missionSafeFilename(m)), missionPageTitle(m));
	const label = escapeWikiText(missionPageTitle(m));
	return title === label ? `[[${title}]]` : `[[${title}|${label}]]`;
}

// Share of the random pool for the whole name group (variants pool together).
function poolShare(group: MissionModifier[]): number {
	const weights = loadModifierWeights();
	const total = [...weights.values()].reduce((a, b) => a + b, 0);
	const mine = group.reduce((a, m) => a + (weights.get(m.ID) ?? 0), 0);
	return total > 0 ? mine / total : 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────

function buildIncompatibleSection(group: MissionModifier[]): string {
	const missions = [...new Set(group.flatMap((m) => m.IncompatibleMissions ?? []))];
	const byID = getModifiersByID();
	const mods = new Map<string, MissionModifier>();
	for (const id of new Set(group.flatMap((m) => m.IncompatibleModifiers ?? []))) {
		const target = byID.get(id);
		if (target && !group.includes(target)) mods.set(modifierPageTitle(target), target);
	}
	if (missions.length === 0 && mods.size === 0) return '';

	const out: string[] = [];
	if (mods.size > 0) {
		out.push("'''Modifiers that cannot be combined with this one:'''");
		for (const [, m] of [...mods].sort((a, b) => a[0].localeCompare(b[0]))) {
			out.push(`* ${modifierLink(m)}`);
		}
	}
	if (missions.length > 0) {
		if (out.length > 0) out.push('');
		out.push("'''Missions this modifier never appears in:'''");
		for (const key of missions) out.push(`* ${missionLink(key)}`);
	}
	return out.join('\n') + '\n';
}

function buildAppearsSection(group: MissionModifier[]): string {
	const ids = new Set(group.map((m) => m.ID));
	const share = poolShare(group);
	const out: string[] = [];
	if (share > 0) {
		out.push(
			`* '''Random missions:''' ${fmtPct(share)} of rolled modifiers (see [[Mission Modifiers]])`
		);
	} else {
		out.push(`* '''Random missions:''' not part of the random modifier pool`);
	}
	const weeks = loadOvertime().weeks.filter((w) => w.modifierIDs.some((id) => ids.has(id)));
	if (weeks.length > 0) {
		out.push(
			`* '''[[Overtime Assignment]]:''' ${weeks.map((w) => `week of ${formatDate(w.startTime)}`).join('; ')}`
		);
	}
	return out.join('\n') + '\n';
}

function buildVariantsTable(group: MissionModifier[]): string {
	if (group.length < 2) return '';
	const weights = loadModifierWeights();
	const out = [
		'{| class="wikitable sortable"',
		'! ID !! Danger !! XP !! Stackable !! Random pool weight'
	];
	for (const v of group) {
		out.push('|-');
		out.push(
			`| ${v.ID} || ${v.Danger ?? ''} || ${formatXP(v.XPMultiplier)} || ${v.CanStack ? 'Yes' : 'No'} || ${weights.get(v.ID) ?? 0}`
		);
	}
	out.push('|}');
	return out.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildModifierContext(m: MissionModifier): Record<string, unknown> {
	const group = loadModifierGroups().get(modifierName(m)) ?? [m];
	const name = escapeWikiText(modifierName(m)).replace(/_/g, ' ');
	const description = descriptionToWiki(m.Description);
	const incompatibleSection = buildIncompatibleSection(group);
	const variantsSection = buildVariantsTable(group);

	return {
		name,
		pageTitle: modifierPageTitle(m),
		apiName: escapeWikiText(m.ModifierName),
		icon: `${displayFilename(m)}_Icon.png`,
		danger: m.Danger ?? '',
		xpMultiplier: formatXP(m.XPMultiplier),
		stackable: m.CanStack ? 'Yes' : 'No',
		description,
		seoDescription: description
			? `${name} mission modifier — ${plainText(description)}`.slice(0, 280)
			: `${name} mission modifier in Mycopunk.`,
		incompatibleSection,
		hasIncompatible: incompatibleSection.length > 0,
		appearsSection: buildAppearsSection(group),
		variantsSection,
		hasVariants: variantsSection.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<MissionModifier>({
	name: 'mission-modifiers',
	dumpKey: 'missionModifiers',
	loadItems: loadMissionModifiers,
	safeFilename,
	displayFilename,
	pageTitle: modifierPageTitle,
	identLabel: (m) => `${m.ModifierName} (ID: ${m.ID})`,
	infoboxDescription: (m) => m.Description ?? '',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history', 'bugs'],
		autoGenSections: ['description', 'incompatibilities', 'where it appears', 'variants'],
		infoboxTemplateName: 'Infobox mission modifier'
	},
	templateName: 'mission-modifier-source.wiki',
	skeletonTemplateName: 'mission-modifier-skeleton.wiki',
	contextBuilder: buildModifierContext,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (m) => `${displayFilename(m)}_Icon.png`,
			targetFilename: (m) => `${displayFilename(m)}_Icon.png`,
			description: (m) =>
				[
					`'''${modifierName(m)}'''`,
					'',
					`Icon for the ${modifierName(m)} mission modifier in Mycopunk.`,
					'',
					`[[Category:Mission Modifier Icons]]`
				].join('\n')
		}
	],
	icon: {
		getTexture: (m) => m.Icon ?? null
	}
});
