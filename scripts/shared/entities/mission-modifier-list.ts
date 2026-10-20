// Singleton "Mission Modifiers" overview page: sortable table of every
// modifier plus the global modifier-roll parameters (`missionGeneration`).

import { defineEntity } from '../entity-registry';
import { fmtPct } from '../format-utils';
import {
	loadMissionGeneration,
	loadMissionModifiers,
	loadModifierGroups,
	loadModifierWeights,
	loadOvertime,
	modifierName
} from '../load-mission-modifiers';
import { descriptionToWiki } from '../wiki-text';
import { formatXP, modifierLink } from './mission-modifiers';

interface ModifierList {
	title: string;
}

const PAGE_TITLE = 'Mission Modifiers';

function buildTable(): string {
	const groups = loadModifierGroups();
	const weights = loadModifierWeights();
	const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
	const overtimeIDs = new Set(loadOvertime().weeks.flatMap((w) => w.modifierIDs));

	const out = [
		'{| class="wikitable sortable"',
		'! Modifier !! Danger !! XP !! Stackable !! Random pool !! In Overtime rotation !! Effect'
	];
	for (const m of loadMissionModifiers()) {
		const group = groups.get(modifierName(m)) ?? [m];
		const weight = group.reduce((a, v) => a + (weights.get(v.ID) ?? 0), 0);
		const inOvertime = group.some((v) => overtimeIDs.has(v.ID));
		out.push('|-');
		out.push(
			`| ${modifierLink(m)} || ${m.Danger ?? ''} || ${formatXP(m.XPMultiplier)} || ${m.CanStack ? 'Yes' : 'No'} || ${weight > 0 ? fmtPct(weight / totalWeight) : '—'} || ${inOvertime ? 'Yes' : 'No'} || ${descriptionToWiki(m.Description)}`
		);
	}
	out.push('|}');
	return out.join('\n') + '\n';
}

function buildCountTable(): string {
	const { chance, bands } = loadMissionGeneration();
	const out = [
		'{| class="wikitable"',
		'! Modifiers on the mission !! Chance',
		'|-',
		`| 0 || ${fmtPct(1 - chance + chance * (bands.find((b) => b.count === 0)?.probability ?? 0))}`
	];
	for (const b of bands.filter((b) => b.count > 0)) {
		out.push('|-');
		out.push(`| ${b.count} || ${fmtPct(chance * b.probability)}`);
	}
	out.push('|}');
	return out.join('\n') + '\n';
}

export function buildModifierListContext(): Record<string, unknown> {
	const { chance } = loadMissionGeneration();
	return {
		pageTitle: PAGE_TITLE,
		seoDescription: 'All mission modifiers in Mycopunk: danger, XP bonus, stacking and spawn odds.',
		modifierCount: loadMissionModifiers().length,
		chancePct: fmtPct(chance),
		tableSection: buildTable(),
		countSection: buildCountTable()
	};
}

export const entity = defineEntity<ModifierList>({
	name: 'mission-modifier-list',
	dumpKey: 'missionGeneration',
	loadItems: () => [{ title: PAGE_TITLE }],
	safeFilename: () => 'Mission_Modifiers',
	displayFilename: () => 'Mission_Modifiers',
	pageTitle: () => PAGE_TITLE,
	identLabel: () => PAGE_TITLE,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['overview', 'all mission modifiers', 'modifiers per mission'],
		infoboxTemplateName: 'Infobox mission modifier list'
	},
	templateName: 'mission-modifier-list-source.wiki',
	skeletonTemplateName: 'mission-modifier-list-skeleton.wiki',
	contextBuilder: buildModifierListContext
});
