// Fulfillments singleton: the in-game achievement catalog (Career / Mission /
// HUB / Gear tabs) rendered as one overview page with a sortable table per
// category. Wrapped in a one-element array so it plugs into the per-entity
// pipeline without special-casing.

import { PAGE_TITLE as OVERTIME_PAGE_TITLE } from './overtime-assignment';
import type { FulfillmentEntry, LevelUnlockEntry1 } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, plainText } from '../wiki-text';
import { defineEntity, lazyLoad } from '../entity-registry';
import { describeLevelUnlock } from '../reward-utils';
import { loadSkins, plainName as skinPlainName, skinPageTitle } from './skins';
import { loadResources, plainName as resourcePlainName, resourcePageTitle } from './resources';
import { loadGears, gearPageTitle } from './gears';
import { loadCharacters, characterPageTitle } from './characters';
import { loadMissions, missionPageTitle } from './missions';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export interface FulfillmentsSingleton {
	id: 'fulfillments';
	entries: FulfillmentEntry[];
}

const CATEGORY_ORDER: FulfillmentEntry['Category'][] = ['Career', 'Mission', 'Gear', 'HUB'];

export function loadFulfillments(): FulfillmentsSingleton[] {
	const data = readDump() as unknown as { fulfillments?: Record<string, FulfillmentEntry> };
	if (!data?.fulfillments || typeof data.fulfillments !== 'object') {
		throw new Error(`Invalid data.json shape: expected a 'fulfillments' object`);
	}
	const entries = Object.values(data.fulfillments);
	return [{ id: 'fulfillments', entries }];
}

export function safeFilename(): string {
	return 'fulfillments';
}

export function displayFilename(): string {
	return 'Fulfillments';
}

export function fulfillmentsPageTitle(): string {
	return 'Fulfillments';
}

// ─────────────────────────────────────────────────────────────────────────
// Reward lookups
// ─────────────────────────────────────────────────────────────────────────

// Upgrade ID → fulfillments that grant it. Every fulfillment upgrade reward in
// v2.0 is a cosmetic, so this is meant for the skin pages.
export const loadFulfillmentRewardsByUpgrade = lazyLoad(() => {
	const out = new Map<string, FulfillmentEntry[]>();
	for (const f of loadFulfillments()[0].entries) {
		if (f.Reward?.Type !== 'LevelUnlock_Upgrade' || !f.Reward.Upgrade) continue;
		const id = String(f.Reward.Upgrade);
		out.set(id, [...(out.get(id) ?? []), f]);
	}
	return out;
});

const getSkinLinks = lazyLoad(() => {
	const out = new Map<string, string>();
	for (const s of loadSkins()) {
		out.set(String(s.upgrade.ID), `[[${skinPageTitle(s)}|${escapeWikiText(skinPlainName(s))}]]`);
	}
	return out;
});

const getResourceLinks = lazyLoad(() => {
	const out = new Map<string, string>();
	for (const r of loadResources()) {
		const title = resourcePageTitle(r);
		const name = resourcePlainName(r);
		out.set(r.ID, title === name ? `[[${title}]]` : `[[${title}|${name}]]`);
	}
	return out;
});

const getTargetLinks = lazyLoad(() => {
	const out = new Map<string, string>();
	for (const g of loadGears()) out.set(`gear:${g.APIName}`, `[[${gearPageTitle(g)}]]`);
	for (const c of loadCharacters()) out.set(`gear:${c.APIName}`, `[[${characterPageTitle(c)}]]`);
	for (const m of loadMissions()) {
		const name = plainText(m.PlainName ?? m.MissionName ?? m.ID);
		const title = missionPageTitle(m);
		out.set(`mission:${m.ID}`, title === name ? `[[${title}]]` : `[[${title}|${name}]]`);
	}
	return out;
});

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

function renderReward(reward: LevelUnlockEntry1 | undefined): string {
	if (!reward) return '—';
	if (reward.Type === 'LevelUnlock_Upgrade' && reward.Upgrade) {
		const link = getSkinLinks().get(String(reward.Upgrade));
		if (link) return `${link} (skin)`;
	}
	if (reward.Type === 'LevelUnlock_Resource' && reward.Resource?.ResourceID) {
		const link = getResourceLinks().get(reward.Resource.ResourceID);
		if (link) return `${reward.Resource.Count > 1 ? `${reward.Resource.Count} ` : ''}${link}`;
	}
	return describeLevelUnlock(reward) || '—';
}

function renderTarget(f: FulfillmentEntry): string {
	const links = getTargetLinks();
	const parts: string[] = [];
	if (f.TargetGear) parts.push(links.get(`gear:${f.TargetGear}`) ?? escapeWikiText(f.TargetGear));
	if (f.Mission && f.Mission !== '??') {
		parts.push(links.get(`mission:${f.Mission}`) ?? escapeWikiText(f.Mission));
	}
	if (f.MissionContainer === 'weeklyovertime') parts.push(`[[${OVERTIME_PAGE_TITLE}]]`);
	return parts.join(', ');
}

function renderNotes(f: FulfillmentEntry): string {
	const notes: string[] = [];
	if (f.IsHidden) notes.push('Hidden');
	if (f.PlatformAchievementID) notes.push('Steam achievement');
	if (f.Element) notes.push(`Element: ${f.Element}`);
	if (f.Rarities && f.Rarities !== 'All') notes.push(`Rarity: ${f.Rarities}`);
	if (f.MinThreat) notes.push(`Threat ${f.MinThreat}+`);
	if (f.DiscoverAll) notes.push('Every upgrade of that rarity');
	return notes.join('; ');
}

function buildCategoryTable(entries: FulfillmentEntry[]): string {
	const out = [
		'{| class="wikitable sortable"',
		'! Fulfillment !! Target !! Required !! Score !! Reward !! Notes'
	];
	for (const f of entries) {
		const threshold = f.CompletionThreshold ?? 0;
		out.push('|-');
		out.push(
			`| ${escapeWikiText(plainText(f.Description) || f.ID)} || ${renderTarget(f)} || ` +
				`${threshold > 0 ? threshold : '—'} || ${f.Score ?? 0} || ${renderReward(f.Reward)} || ${renderNotes(f)}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

function buildCategoriesSection(c: FulfillmentsSingleton): string {
	const sections: string[] = [];
	for (const cat of CATEGORY_ORDER) {
		const entries = c.entries
			.filter((f) => f.Category === cat)
			.sort(
				(a, b) =>
					Number(a.IsHidden ?? false) - Number(b.IsHidden ?? false) ||
					a.ID.toLowerCase().localeCompare(b.ID.toLowerCase())
			);
		if (entries.length === 0) continue;
		const label = entries[0].CategoryName ?? cat;
		const total = entries.reduce((n, f) => n + (f.Score ?? 0), 0);
		sections.push(
			`=== ${label} ===\n${entries.length} fulfillments worth ${total} score in total.\n\n${buildCategoryTable(entries)}`
		);
	}
	return sections.join('\n\n');
}

export function buildFulfillmentsContext(c: FulfillmentsSingleton): Record<string, unknown> {
	const totalScore = c.entries.reduce((n, f) => n + (f.Score ?? 0), 0);
	return {
		name: 'Fulfillments',
		pageTitle: fulfillmentsPageTitle(),
		count: c.entries.length,
		totalScore,
		seoDescription:
			'All fulfillments (in-game achievements), their scores and rewards in Mycopunk.',
		categoriesSection: buildCategoriesSection(c)
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<FulfillmentsSingleton>({
	name: 'fulfillments',
	dumpKey: 'fulfillments',
	loadItems: loadFulfillments,
	safeFilename,
	displayFilename,
	pageTitle: fulfillmentsPageTitle,
	identLabel: () => 'fulfillments',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['career', 'mission', 'gear', 'hub', 'fulfillments', 'overview'],
		infoboxTemplateName: 'Infobox fulfillments'
	},
	templateName: 'fulfillments-source.wiki',
	skeletonTemplateName: 'fulfillments-skeleton.wiki',
	contextBuilder: buildFulfillmentsContext
	// no fileTypes — fulfillments have no icon
});
