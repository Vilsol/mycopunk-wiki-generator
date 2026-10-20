// Singleton "Overtime Assignment" page: weekly mission container with a
// scheduled modifier rotation, a minimum threat and an overtime-only threat
// profile that scales reward chances.

import type { Threat } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity } from '../entity-registry';
import { fmtNum, fmtPct } from '../format-utils';
import { loadOvertime } from '../load-mission-modifiers';
import type { OvertimeReward } from '../load-mission-modifiers';
import { finalTitle, titleKey } from '../title-resolver';
import { escapeWikiText, plainText } from '../wiki-text';
import { loadPlanets, regionLink } from '../load-world';
import { formatDate, getModifiersByID, modifierLink } from './mission-modifiers';
import { safeFilename as threatSafeFilename, threatPageTitle } from './threats';

interface OvertimeItem {
	title: string;
}

const PAGE_TITLE = 'Overtime Assignment';
const RARITIES = ['Standard', 'Rare', 'Epic', 'Exotic', 'Oddity', 'Contraband'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function loadThreatList(): Threat[] {
	return Object.values((readDump() as unknown as { threats: Record<string, Threat> }).threats);
}

function threatLink(t: Threat): string {
	const title = finalTitle(titleKey('threats', threatSafeFilename(t)), threatPageTitle(t));
	const label = escapeWikiText(plainText(t.NumberLabel ?? t.ID));
	return `[[${title}|${label}]]`;
}

function describeReward(r: OvertimeReward): string {
	const count = r.count > 1 ? `${r.count}× ` : '';
	switch (r.type) {
		case 'LevelUnlock_Resource':
		case 'LevelUnlock_Antimass': {
			const resources = (readDump() as unknown as { resources: Record<string, { Name?: string }> })
				.resources;
			const key = r.resourceKey ?? '';
			const name = escapeWikiText(resources[key]?.Name ?? key);
			return `${count}${r.resourceCount ?? 1} [[${name}]]`;
		}
		case 'LevelUnlock_UpgradeRarity':
			return `${count}${RARITIES[r.rarity ?? -1] ?? 'Random'} upgrade`;
		case 'LevelUnlock_Skin':
			return `${count}Skin`;
		default:
			return r.type.replace(/^LevelUnlock_/, '');
	}
}

function buildRewardsTable(rewards: OvertimeReward[], multiplier: number): string {
	const out = ['{| class="wikitable"', '! Reward !! Chance'];
	for (const r of rewards) {
		const chance = r.profile ? Math.min(1, r.chance * multiplier) : r.chance;
		out.push('|-');
		out.push(`| ${describeReward(r)} || ${fmtPct(chance)}`);
	}
	out.push('|}');
	return out.join('\n') + '\n';
}

export function buildOvertimeContext(): Record<string, unknown> {
	const planetsByKey = new Map(loadPlanets().map((p) => [p.key, p]));
	const ot = loadOvertime();
	const threats = loadThreatList();
	const byID = getModifiersByID();
	const minThreat = threats[ot.minThreat];
	const days = ot.resetInterval / 86400;
	const first = ot.weeks[0]?.startTime;
	const resetAt =
		first === undefined
			? ''
			: `${WEEKDAYS[new Date(first * 1000).getUTCDay()]}s at ${formatDate(first).slice(11)}`;

	const rotation = ['{| class="wikitable"', '! Week starting !! Modifiers'];
	for (const w of ot.weeks) {
		const mods = w.modifierIDs.map((id) => {
			const m = byID.get(id);
			return m ? modifierLink(m) : `Unknown (${id})`;
		});
		rotation.push('|-');
		rotation.push(`| ${formatDate(w.startTime)} || ${mods.join(', ')}`);
	}
	rotation.push('|}');

	// Multiplier that applies at the minimum threat, where the container is first playable.
	const profile = ot.profile;
	const profileRows: string[] = [];
	if (profile) {
		profileRows.push('{| class="wikitable"', '! Threat !! Reward chance multiplier');
		threats.forEach((t, i) => {
			profileRows.push('|-');
			profileRows.push(`| ${threatLink(t)} || ×${fmtNum(profile.Threats[i] ?? 0)}`);
		});
		profileRows.push('|}');
	}
	const multiplier = profile?.Threats[ot.minThreat] ?? 1;

	return {
		pageTitle: PAGE_TITLE,
		seoDescription: `Overtime Assignment: the weekly Mycopunk mission with rotating modifiers, resetting every ${fmtNum(days)} days.`,
		resetDays: fmtNum(days),
		resetSeconds: String(ot.resetInterval),
		resetAt,
		minThreatLink: minThreat ? threatLink(minThreat) : `Threat ${ot.minThreat + 1}`,
		minIntensity: String(ot.minIntensity),
		rotationSection: rotation.join('\n') + '\n',
		hasRotation: ot.weeks.length > 0,
		profileSection: profileRows.join('\n') + (profileRows.length > 0 ? '\n' : ''),
		hasProfile: profileRows.length > 0,
		rewardsSection: buildRewardsTable(ot.rewards, multiplier),
		hasRewards: ot.rewards.length > 0,
		repeatableSection: buildRewardsTable(ot.repeatableRewards, multiplier),
		hasRepeatable: ot.repeatableRewards.length > 0,
		includedRegions: ot.regions.included.map((r) => regionLink(r, planetsByKey)).join(', '),
		excludedRegions: ot.regions.excluded.map((r) => regionLink(r, planetsByKey)).join(', ')
	};
}

export const entity = defineEntity<OvertimeItem>({
	name: 'overtime-assignment',
	dumpKey: 'missionContainers',
	loadItems: () => [{ title: PAGE_TITLE }],
	safeFilename: () => 'Overtime_Assignment',
	displayFilename: () => 'Overtime_Assignment',
	pageTitle: () => PAGE_TITLE,
	identLabel: () => PAGE_TITLE,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['overview', 'modifier rotation', 'rewards', 'reward chances', 'regions'],
		infoboxTemplateName: 'Infobox overtime assignment'
	},
	templateName: 'overtime-assignment-source.wiki',
	skeletonTemplateName: 'overtime-assignment-skeleton.wiki',
	contextBuilder: buildOvertimeContext
});
