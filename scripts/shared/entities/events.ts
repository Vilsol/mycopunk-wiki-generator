// Events singleton: one "Events" page listing the global (community-wide)
// events and the random mission events. Neither carries enough data for a
// page of its own (no localized titles or descriptions in the dump).

import type { Enemy, Gear, GlobalEvent, MissionEvent } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity, lazyLoad } from '../entity-registry';
import { fmtNum, fmtPct } from '../format-utils';
import {
	EVENTS_PAGE,
	globalEventTitle,
	loadGlobalEvents,
	loadMissionEvents,
	missionEventTitle
} from '../load-world';
import { buildRewardsTable } from '../reward-utils';
import { escapeWikiText, plainText } from '../wiki-text';
import { loadMissions, missionPageTitle } from './missions';
import { loadUpgradesByID } from './characters';

export interface EventsSingleton {
	id: 'events';
}

export function loadEvents(): EventsSingleton[] {
	return [{ id: 'events' }];
}

export function safeFilename(): string {
	return 'events';
}

export function displayFilename(): string {
	return 'Events';
}

export function eventsPageTitle(): string {
	return EVENTS_PAGE;
}

const getUpgradesByID = lazyLoad(loadUpgradesByID);

function localized(id: string | undefined): string {
	if (!id) return '';
	const data = readDump() as unknown as {
		localization?: Record<string, { Blocks?: { Text?: string }[] }>;
	};
	return plainText(data.localization?.[id]?.Blocks?.[0]?.Text).trim();
}

function formatDate(unix: number): string {
	return new Date(unix * 1000).toISOString().slice(0, 10);
}

function humanize(subclass: string): string {
	return subclass.replace(/([a-z])([A-Z])/g, '$1 $2');
}

// ─────────────────────────────────────────────────────────────────────────
// Global events
// ─────────────────────────────────────────────────────────────────────────

function buildGlobalEventBlock(ge: GlobalEvent): string {
	const data = readDump() as unknown as {
		gears?: Record<string, Gear>;
		missions?: Record<string, { PlainName?: string }>;
	};
	const rows: [string, string][] = [['Type', humanize(ge.Subclass)]];
	if (ge.Deactivate) rows.push(['Status', 'Retired']);
	if (ge.EndDate) rows.push(['Ended', formatDate(ge.EndDate)]);
	if (ge.TotalRequiredProgress) {
		rows.push(['Total required progress', ge.TotalRequiredProgress.toLocaleString('en-US')]);
	}
	if (ge.ProgressOnMissionCompleted) {
		rows.push(['Progress per completed mission', fmtNum(ge.ProgressOnMissionCompleted)]);
	}
	if (ge.EndMission) {
		const mission = loadMissions().find((m) => m.ID === ge.EndMission);
		if (mission) rows.push(['Final mission', `[[${missionPageTitle(mission)}]]`]);
	}
	const stats = (ge.ProgressStats ?? [])
		.map((s) => localized(s.TitleID) || s.TitleID)
		.filter((s): s is string => !!s);
	if (stats.length > 0) rows.push(['Tracked stats', stats.map(escapeWikiText).join(', ')]);
	if (ge.MustParticipateToClaimRewards) rows.push(['Rewards', 'Participation required']);

	const out = [`=== ${globalEventTitle(ge)} ===`];
	out.push('{| class="wikitable"');
	for (const [label, value] of rows) {
		out.push('|-', `! ${label}`, `| ${value}`);
	}
	out.push('|}');

	const corp = ge.CorpData ?? [];
	if (corp.length > 0) {
		out.push('', "'''Contest sides:'''");
		for (const c of corp) {
			const gear = c.WeaponID ? data.gears?.[c.WeaponID] : undefined;
			const weapon = gear?.Name ? `[[${plainText(gear.Name)}]]` : (c.WeaponID ?? '?');
			out.push(`* ${weapon}${c.TicketResource ? ` (ticket: ${c.TicketResource})` : ''}`);
		}
	}

	const rewards = buildRewardsTable(ge.Rewards, { upgradesByID: getUpgradesByID() });
	if (rewards) out.push('', "'''Completion rewards:'''", rewards);
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Mission events
// ─────────────────────────────────────────────────────────────────────────

function minMax(r: { Min?: number; Max?: number } | undefined): string {
	return r ? `${fmtNum(r.Min ?? 0)}–${fmtNum(r.Max ?? 0)} s` : '';
}

function buildMissionEventBlock(me: MissionEvent, totalWeight: number): string {
	const data = readDump() as unknown as { enemies?: Record<string, Enemy> };
	const rows: [string, string][] = [
		['Pick weight', `${me.Weight} (${fmtPct(totalWeight > 0 ? me.Weight / totalWeight : 0)})`]
	];
	if (me.AmalgamationClass) {
		const name = plainText(data.enemies?.[me.AmalgamationClass]?.Name).trim();
		if (name) rows.push(['Spawns', `[[${name}]]`]);
	}
	const raw = (me.RawData ?? {}) as { moveDuration?: number };
	if (me.Subclass === 'RocketPassover' && raw.moveDuration) {
		rows.push(['Duration', `${fmtNum(raw.moveDuration)} s`]);
	}

	const out = [`=== ${missionEventTitle(me)} ===`];
	out.push('{| class="wikitable"');
	for (const [label, value] of rows) {
		out.push('|-', `! ${label}`, `| ${value}`);
	}
	out.push('|}');

	if (me.Weather && me.Weather.length > 0) {
		const durations: Record<string, string> = {
			Rain: minMax(me.RainDuration),
			Fog: minMax(me.FogDuration),
			SulfurRain: minMax(me.SulfurRainDuration)
		};
		const weatherTotal = me.Weather.reduce((sum, w) => sum + (w.Weight ?? 0), 0);
		out.push('', '{| class="wikitable"', '! Weather !! Weight !! Chance !! Duration');
		for (const w of me.Weather) {
			const key = w.Key ?? '?';
			out.push(
				'|-',
				`| ${humanize(key)} || ${w.Weight ?? 0} || ${fmtPct(weatherTotal > 0 ? (w.Weight ?? 0) / weatherTotal : 0)} || ${durations[key] || '—'}`
			);
		}
		out.push('|}');
	}
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildEventsContext(): Record<string, unknown> {
	const missionEvents = loadMissionEvents();
	const totalWeight = missionEvents.reduce((sum, e) => sum + e.Weight, 0);
	return {
		name: EVENTS_PAGE,
		pageTitle: EVENTS_PAGE,
		seoDescription:
			'Global community events and random mission events (amalgamations, rocket passovers, weather) in Mycopunk.',
		globalEventsSection: loadGlobalEvents().map(buildGlobalEventBlock).join('\n\n'),
		missionEventsSection: missionEvents
			.map((e) => buildMissionEventBlock(e, totalWeight))
			.join('\n\n')
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<EventsSingleton>({
	name: 'events',
	dumpKey: 'globalEvents', // singleton — loadEvents wraps globalEvents + missionEvents
	loadItems: loadEvents,
	safeFilename,
	displayFilename,
	pageTitle: eventsPageTitle,
	identLabel: () => 'events',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['global events', 'mission events', 'overview'],
		infoboxTemplateName: 'Infobox events'
	},
	templateName: 'events-source.wiki',
	skeletonTemplateName: 'events-skeleton.wiki',
	contextBuilder: buildEventsContext
});
