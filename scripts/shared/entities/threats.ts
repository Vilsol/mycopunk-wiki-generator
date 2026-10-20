// Threat entity: per-tier mission rewards and difficulty scaling tables +
// classifier config.
//
// Each Threat tier carries `MissionRewards: LevelUnlockEntry[]` — same shape as
// gear LevelUnlocks. We render those into a wikitable on each threat's page,
// next to the tier's column of `difficulty` / `threatProfiles`.

import type { Threat } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName, stripHtml } from '../wiki-text';
import { defineEntity, lazyLoad, loadFromDump } from '../entity-registry';
import { loadUpgradesByID } from './characters';
import { rgbaToHex } from '../format-utils';
import { buildRewardsTable } from '../reward-utils';
import {
	ENEMY_TYPES,
	PLAYER_HEADERS,
	fmtMult,
	fmtProfileValue,
	getDifficulty,
	getThreatProfiles,
	humanize,
	playerCells
} from '../difficulty';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export const loadThreats = loadFromDump<Threat>({ dumpKey: 'threats' });

export function safeFilename(threat: Threat): string {
	return sanitizeAPIName(threat.ID);
}

// Names may contain rich-text wrappers (e.g. `<font=H>Impossible</font>`).
function plainName(threat: Threat): string {
	return stripHtml(threat.Name).trim();
}

export function displayFilename(threat: Threat): string {
	const name = plainName(threat) || threat.ID;
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function threatPageTitle(threat: Threat): string {
	return plainName(threat) || threat.NumberLabel || threat.ID;
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

const getUpgradesByID = lazyLoad(loadUpgradesByID);

function buildScalingSection(tierIndex: number): string {
	const diff = getDifficulty();
	const out: string[] = [];

	const grids: [string, Parameters<typeof playerCells>[0]][] = [];
	for (const type of ENEMY_TYPES) {
		grids.push([`${type} health`, diff.EnemyHealthScaling?.[type]?.[tierIndex]]);
	}
	grids.push(['Enemy damage', diff.EnemyDamageScaling?.[tierIndex]]);
	grids.push(['Wave size', diff.EnemyWaveSize?.[tierIndex]]);
	grids.push(['Wave interval', diff.EnemyWaveInterval?.[tierIndex]]);
	if (grids.some(([, g]) => g)) {
		out.push('{| class="wikitable"');
		out.push(`! Enemy scaling !! ${PLAYER_HEADERS.join(' !! ')} !! Per player beyond 4`);
		for (const [label, grid] of grids) {
			out.push('|-');
			out.push(`| ${label} || ${playerCells(grid).join(' || ')}`);
		}
		out.push('|}');
	}

	const singles: [string, string][] = [
		['Enemy move speed', fmtMult(diff.EnemyMoveSpeedScaling?.[tierIndex])],
		['Enemy attack speed', fmtMult(diff.EnemyAttackSpeedScaling?.[tierIndex])],
		['Enemy part-seek interval', fmtMult(diff.LookForPartIntervalScaling?.[tierIndex])],
		['Resource reward amount', fmtMult(getEconomyResourceMultiplier(tierIndex))]
	];
	for (const profile of getThreatProfiles()) {
		singles.push([
			`${humanize(profile.Name)} (${profile.Additive ? 'added chance' : 'multiplier'})`,
			fmtProfileValue(profile, profile.Threats[tierIndex])
		]);
	}
	const rows = singles.filter(([, v]) => v !== '—');
	if (rows.length > 0) {
		if (out.length > 0) out.push('');
		out.push('{| class="wikitable"', '! Modifier !! Value');
		for (const [label, value] of rows) {
			out.push('|-');
			out.push(`| ${label} || ${value}`);
		}
		out.push('|}');
	}
	return out.join('\n');
}

function getEconomyResourceMultiplier(tierIndex: number): number | undefined {
	return readDump().economy?.ResourceAmountMultiplier?.[tierIndex];
}

export function buildThreatContext(threat: Threat): Record<string, unknown> {
	const upgradesByID = getUpgradesByID();
	const rewardsSection = buildRewardsTable(threat.MissionRewards, { upgradesByID });
	const tierNum = threat.ID.replace(/^threat/, '');
	const scalingSection = /^\d+$/.test(tierNum) ? buildScalingSection(Number(tierNum) - 1) : '';

	return {
		name: escapeWikiText(threat.Name ?? threat.ID),
		pageTitle: threatPageTitle(threat),
		apiName: escapeWikiText(threat.ID),
		numberLabel: threat.NumberLabel ?? '',
		tierNum,
		colorHex: rgbaToHex(threat.Color),
		icon: `${displayFilename(threat)}_Icon.png`,
		seoDescription: `${plainName(threat) || threat.ID} — ${threat.NumberLabel ?? 'mission threat tier'} in Mycopunk.`,
		rewardsSection,
		hasRewardsSection: rewardsSection.length > 0,
		scalingSection,
		hasScalingSection: scalingSection.length > 0
	};
}

export function loadThreatGenerationData() {
	return {
		threats: loadThreats(),
		upgradesByID: getUpgradesByID(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Threat>({
	name: 'threats',
	dumpKey: 'threats',
	loadItems: loadThreats,
	safeFilename,
	displayFilename,
	pageTitle: threatPageTitle,
	identLabel: (t) => `${t.ID} (${t.Name ?? '(no name)'})`,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['rewards', 'mission rewards', 'scaling', 'overview'],
		infoboxTemplateName: 'Infobox threat'
	},
	templateName: 'threat-source.wiki',
	skeletonTemplateName: 'threat-skeleton.wiki',
	contextBuilder: buildThreatContext,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (t) => `${displayFilename(t)}_Icon.png`,
			targetFilename: (t) => `${displayFilename(t)}_Icon.png`,
			description: (t) =>
				[
					`'''${t.Name ?? t.ID}'''`,
					'',
					`Icon for ${t.NumberLabel ?? t.ID} (${t.Name ?? t.ID}) in Mycopunk.`,
					'',
					`[[Category:Threat Icons]]`
				].join('\n')
		}
	],
	icon: {
		getTexture: (t) => t.Icon ?? null
	}
});
