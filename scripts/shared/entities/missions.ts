// Mission entity. Each non-secret mission becomes one wiki page.
//
// Page composition:
//   - Infobox (icon, type, color, level/intensity gates, key flags)
//   - Description + StartVoiceline briefing blockquote
//   - Stages section: each objective resolved from RawData embedded inline,
//     with its ObjectiveInfoList steps + voicelines + cross-refs to the
//     enemies/customWaves/resources the objective references
//   - Rewards section (AdditionalRewards + RepeatRewards)
//   - Related section: backlinks from directives/globalEvents that reference
//     this mission

import type {
	ObjectiveEntry,
	LevelUnlockEntry,
	Directive,
	GlobalEvent,
	Enemy,
	Localization
} from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import {
	loadMissions,
	displayFilename,
	missionPageTitle,
	safeFilename,
	type MissionEntry
} from '../load-missions';
import { rgbaToHex } from './format-utils';
import { buildRewardsTable } from './reward-utils';
import type { EntityClassifierConfig } from '../upload-pipeline';

export { loadMissions, displayFilename, missionPageTitle, safeFilename };

// ─────────────────────────────────────────────────────────────────────────
// RawData @ref walking
// ─────────────────────────────────────────────────────────────────────────
//
// Mission and objective RawData blobs are Unity-serialized. Cross-entity
// references appear as `{ instanceID: N, "@ref": "<kind>:<key>" }`. We walk
// the blob to collect all refs of a given kind without depending on the
// specific field name (which can drift across game versions).

interface UnityRef {
	instanceID?: number;
	'@ref'?: string;
}

function isRefObject(v: unknown): v is UnityRef {
	return (
		typeof v === 'object' &&
		v !== null &&
		'@ref' in (v as object) &&
		typeof (v as UnityRef)['@ref'] === 'string'
	);
}

function collectRefs(node: unknown, kind: string, out: string[]): void {
	if (node === null || node === undefined) return;
	if (Array.isArray(node)) {
		for (const item of node) collectRefs(item, kind, out);
		return;
	}
	if (typeof node !== 'object') return;
	if (isRefObject(node)) {
		const ref = node['@ref'] ?? '';
		if (ref.startsWith(`${kind}:`)) out.push(ref.slice(kind.length + 1));
		return;
	}
	for (const v of Object.values(node as Record<string, unknown>)) {
		collectRefs(v, kind, out);
	}
}

function refsOfKind(raw: unknown, kind: string): string[] {
	const all: string[] = [];
	collectRefs(raw, kind, all);
	// Preserve first-occurrence order, dedupe.
	return [...new Set(all)];
}

// ─────────────────────────────────────────────────────────────────────────
// Lookup tables (mission-side dependencies)
// ─────────────────────────────────────────────────────────────────────────

interface DumpShape {
	objectives?: Record<string, ObjectiveEntry>;
	directives?: Record<string, Directive>;
	globalEvents?: Record<string, GlobalEvent>;
	missions?: Record<string, MissionEntry>;
	enemies?: Record<string, Enemy>;
	localization?: Record<string, Localization>;
}

function loadObjectivesByName(): Map<string, ObjectiveEntry> {
	const data = readDump() as unknown as DumpShape;
	const out = new Map<string, ObjectiveEntry>();
	for (const o of Object.values(data.objectives ?? {})) {
		if (o?.Name) out.set(o.Name, o);
	}
	return out;
}

// Enemies are keyed by stringified ID in the dump (e.g. "2" → Slicer). Objective
// `@ref` values like "enemy:2" use that key directly. Resolved to the enemy's
// Name so cross-refs render as `[[Slicer]]` rather than the opaque numeric ID.
// Note: load-enemies dedups by Name (5× "Brute" collapse to one canonical
// page), so multiple IDs can map to the same wiki target — that's correct.
function loadEnemyNamesByKey(): Map<string, string> {
	const data = readDump() as unknown as DumpShape;
	const out = new Map<string, string>();
	for (const [key, e] of Object.entries(data.enemies ?? {})) {
		const name = (e.Name ?? '').trim();
		if (name) out.set(key, name);
	}
	return out;
}

// Resolve voiceline sequences from `localization`. Many missions carry a
// `prefix_*` family of localization keys that form an in-game ARG/dialogue
// sequence (e.g. cranius_intro / cranius_intro1 / cranius_intro2 …). Walking
// the table once and grouping by the leading token lets us render the full
// sequence on the mission page.
function loadLocalizationByPrefix(): Map<string, Array<{ id: string; text: string }>> {
	const data = readDump() as unknown as DumpShape;
	const out = new Map<string, Array<{ id: string; text: string }>>();
	for (const [id, entry] of Object.entries(data.localization ?? {})) {
		const prefix = id.split('_')[0];
		if (!prefix) continue;
		const text = (entry.Blocks?.[0]?.Text ?? '').trim();
		if (!text) continue;
		const list = out.get(prefix) ?? [];
		list.push({ id, text });
		out.set(prefix, list);
	}
	for (const list of out.values()) list.sort((a, b) => a.id.localeCompare(b.id));
	return out;
}

// Index enemy Names by lowercased APIName / InternalName / sanitized Name so
// we can map a voiceline prefix like "cranius" → enemy "Cranius".
function loadEnemiesByLowercasedKey(): Map<string, string> {
	const data = readDump() as unknown as DumpShape;
	const out = new Map<string, string>();
	for (const e of Object.values(data.enemies ?? {})) {
		const name = (e.Name ?? '').trim();
		if (!name) continue;
		const candidates = [e.APIName, e.InternalName, name];
		for (const c of candidates) {
			if (!c) continue;
			out.set(c.toLowerCase(), name);
		}
	}
	return out;
}

// Backlinks: directives whose Property.Raw.mission["@ref"] points at us.
// Returns Map<missionName, Directive[]>.
function loadDirectivesByMissionRef(): Map<string, Directive[]> {
	const data = readDump() as unknown as DumpShape;
	const out = new Map<string, Directive[]>();
	for (const d of Object.values(data.directives ?? {})) {
		const refs = refsOfKind(d, 'mission');
		for (const ref of refs) {
			const list = out.get(ref) ?? [];
			list.push(d);
			out.set(ref, list);
		}
	}
	return out;
}

// Backlinks: globalEvents whose endMission @ref points at us.
function loadGlobalEventsByMissionRef(): Map<string, GlobalEvent[]> {
	const data = readDump() as unknown as DumpShape;
	const out = new Map<string, GlobalEvent[]>();
	for (const g of Object.values(data.globalEvents ?? {})) {
		const refs = refsOfKind(g, 'mission');
		for (const ref of refs) {
			const list = out.get(ref) ?? [];
			list.push(g);
			out.set(ref, list);
		}
	}
	return out;
}

// ─────────────────────────────────────────────────────────────────────────
// MissionFlags rendering
// ─────────────────────────────────────────────────────────────────────────

const MISSION_FLAG_LABELS: Record<string, string> = {
	NormalMission: 'Normal',
	SecretMission: 'Secret',
	CanJoinDuringMission: 'Joinable in-progress',
	CanRejoin: 'Rejoinable',
	AllowAsLobbyFilter: 'Lobby filter',
	AllowInProceduralLevels: 'Procedural levels',
	AllowInDesignedLevels: 'Designed levels',
	DisableSideObjetives: 'No side objectives',
	DisableEncounters: 'No encounters',
	AlwaysShowInMissionSelect: 'Always shown',
	CanModifyGear: 'Mid-mission gear edit',
	DontShow: 'Hidden in selector'
};

function splitFlags(s: string | undefined): string[] {
	if (!s) return [];
	return s
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0 && t !== 'None' && t !== '0');
}

function describeFlags(flags: string[]): string[] {
	return flags.map((f) => MISSION_FLAG_LABELS[f] ?? f);
}

// ─────────────────────────────────────────────────────────────────────────
// Objective embedding (Stages section)
// ─────────────────────────────────────────────────────────────────────────

function objectiveSubclassChip(o: ObjectiveEntry): string {
	const sub = o.Subclass.replace(/Objective$/, '')
		.replace(/([A-Z])/g, ' $1')
		.trim();
	return sub || o.Subclass;
}

function quoteVoiceline(voice: { Text?: string } | undefined): string {
	const text = (voice?.Text ?? '').trim();
	if (!text) return '';
	return `<blockquote>"${stripHtml(text)}"</blockquote>`;
}

function objectiveCrossRefs(o: ObjectiveEntry, enemyNamesByKey: Map<string, string>): string {
	// Each objective's RawData may reference enemies, customWaves, resources,
	// enemyGroups, missionModifiers. Surface them as a one-line "Involves:" hint
	// so a reader sees what's at stake without diving into RawData.
	const parts: string[] = [];
	const enemies = refsOfKind(o.RawData, 'enemy');
	if (enemies.length > 0) {
		// `enemy:N` — resolve to Name via the dump's parent key. Multiple IDs can
		// map to the same canonical name (e.g. all 5 "Brute" entries → "Brute");
		// dedupe the rendered links so we don't emit `[[Brute]], [[Brute]], …`.
		const names = new Set<string>();
		const fallback: string[] = [];
		for (const e of enemies) {
			const name = enemyNamesByKey.get(e);
			if (name) names.add(name);
			else fallback.push(e);
		}
		const links = [...names].sort().map((n) => `[[${n}]]`);
		const codes = fallback.map((e) => `<code>${e}</code>`);
		parts.push(`Enemies: ${[...links, ...codes].join(', ')}`);
	}
	const groups = refsOfKind(o.RawData, 'enemyGroup');
	if (groups.length > 0) {
		parts.push(`Enemy groups: ${groups.map((g) => `<code>${g}</code>`).join(', ')}`);
	}
	const waves = refsOfKind(o.RawData, 'customWave');
	if (waves.length > 0) {
		parts.push(`Custom waves: ${waves.map((w) => `<code>${w}</code>`).join(', ')}`);
	}
	const resources = refsOfKind(o.RawData, 'resource');
	if (resources.length > 0) {
		parts.push(`Resources: ${resources.map((r) => `[[${r}]]`).join(', ')}`);
	}
	if (parts.length === 0) return '';
	return parts.map((p) => `* ${p}`).join('\n');
}

function buildObjectiveBlock(
	o: ObjectiveEntry,
	index: number,
	enemyNamesByKey: Map<string, string>
): string {
	const heading = o.Title || o.Name;
	const subclass = objectiveSubclassChip(o);
	const startQuote = quoteVoiceline(o.StartVoiceline);
	const completeQuote = quoteVoiceline(o.CompleteVoiceline);
	const refs = objectiveCrossRefs(o, enemyNamesByKey);

	const out: string[] = [];
	out.push(`==== Stage ${index + 1}: ${escapeWikiText(heading)} ====`);
	out.push(`''${subclass}''`);
	out.push('');

	const steps = o.ObjectiveInfoList ?? [];
	if (steps.length > 0) {
		const rows = ['{| class="wikitable"', '! Step !! Title !! Description'];
		for (let i = 0; i < steps.length; i++) {
			const s = steps[i];
			const title = (s.Title ?? s.TitleID ?? '—').trim();
			const desc = (s.Description ?? s.DescriptionID ?? '').trim();
			rows.push('|-');
			rows.push(`| ${i + 1} || ${escapeWikiText(title) || '—'} || ${escapeWikiText(desc) || '—'}`);
		}
		rows.push('|}');
		out.push(rows.join('\n'));
		out.push('');
	}

	if (startQuote) {
		out.push(`'''On start:'''\n${startQuote}`);
	}
	if (completeQuote) {
		out.push(`'''On complete:'''\n${completeQuote}`);
	}
	if (refs) {
		out.push(refs);
	}
	return out.join('\n').trimEnd();
}

function buildStagesSection(
	mission: MissionEntry,
	objectivesByName: Map<string, ObjectiveEntry>,
	enemyNamesByKey: Map<string, string>
): { section: string; count: number } {
	const refs = refsOfKind(mission.RawData, 'objective');
	if (refs.length === 0) return { section: '', count: 0 };
	const blocks: string[] = [];
	for (const ref of refs) {
		const obj = objectivesByName.get(ref);
		if (!obj) {
			blocks.push(`==== ? ${ref} ====\n''(objective not found in dump)''`);
			continue;
		}
		blocks.push(buildObjectiveBlock(obj, blocks.length, enemyNamesByKey));
	}
	return { section: blocks.join('\n\n'), count: refs.length };
}

// ─────────────────────────────────────────────────────────────────────────
// Backlinks (Related section)
// ─────────────────────────────────────────────────────────────────────────

function buildRelatedSection(
	mission: MissionEntry,
	directivesByRef: Map<string, Directive[]>,
	globalEventsByRef: Map<string, GlobalEvent[]>
): string {
	// Mission @refs use the dump key (m.ID), not MissionName — e.g.
	// `mission:oxybreach_e` → look up by `mission.ID === "oxybreach_e"`.
	const refKey = mission.ID;
	const directives = directivesByRef.get(refKey) ?? [];
	const events = globalEventsByRef.get(refKey) ?? [];
	if (directives.length === 0 && events.length === 0) return '';

	const out: string[] = [];
	if (directives.length > 0) {
		out.push("'''Required by mission modifiers:'''");
		for (const d of directives) {
			const name = d.Name ?? `directive_${d.ID}`;
			out.push(`* [[${name} Mission Modifier|${name}]]`);
		}
	}
	if (events.length > 0) {
		out.push("'''Ends global events:'''");
		for (const g of events) {
			// GlobalEvents don't currently have wiki pages — surface as code refs
			// for now. When/if a globalEvents pipeline lands these become wikilinks.
			const id = g.ID ?? '?';
			const sub = g.Subclass ?? '';
			out.push(`* <code>${id}</code>${sub ? ` (${sub})` : ''}`);
		}
	}
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Rewards (uses shared reward-utils)
// ─────────────────────────────────────────────────────────────────────────

function buildRewardsSection(
	additional: LevelUnlockEntry[] | undefined,
	repeat: LevelUnlockEntry[] | undefined
): string {
	const blocks: string[] = [];
	const add = buildRewardsTable(additional);
	if (add) {
		blocks.push("'''On completion:'''");
		blocks.push(add);
	}
	const rep = buildRewardsTable(repeat);
	if (rep) {
		blocks.push("'''On repeat completion:'''");
		blocks.push(rep);
	}
	return blocks.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Voiceline sequence + boss-from-prefix
// ─────────────────────────────────────────────────────────────────────────
//
// The placeholder `???` mission's StartVoiceline.ID is `cranius_intro`. The
// `cranius` prefix matches the enemy APIName "cranius", and 6 cranius_*
// localization keys form a corrupted-text ARG sequence. Generalising:
// take the first underscore-separated token of the StartVoiceline.ID, treat
// it as a tag, look up enemies (boss link) and the full localization family
// (voiceline section).

function voicelinePrefix(mission: MissionEntry): string {
	const id = (mission.StartVoiceline?.ID ?? '').trim();
	if (!id) return '';
	return id.split('_')[0].toLowerCase();
}

function buildVoicelinesSection(
	prefix: string,
	startId: string,
	localizationByPrefix: Map<string, Array<{ id: string; text: string }>>
): string {
	if (!prefix) return '';
	const lines = localizationByPrefix.get(prefix) ?? [];
	if (lines.length === 0) return '';
	const out = ['{| class="wikitable"', '! Line !! Text'];
	for (const { id, text } of lines) {
		const marker = id === startId ? ` ''(start)''` : '';
		out.push('|-');
		out.push(`| <code>${id}</code>${marker} || ''"${stripHtml(text)}"''`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildMissionContext(
	mission: MissionEntry,
	objectivesByName: Map<string, ObjectiveEntry>,
	directivesByRef: Map<string, Directive[]>,
	globalEventsByRef: Map<string, GlobalEvent[]>,
	enemyNamesByKey: Map<string, string>,
	enemiesByLowercasedKey: Map<string, string>,
	localizationByPrefix: Map<string, Array<{ id: string; text: string }>>
): Record<string, unknown> {
	const flags = splitFlags(mission.MissionFlags);
	const flagLabels = describeFlags(flags);
	const stages = buildStagesSection(mission, objectivesByName, enemyNamesByKey);
	const rewards = buildRewardsSection(mission.AdditionalRewards, mission.RepeatRewards);
	const related = buildRelatedSection(mission, directivesByRef, globalEventsByRef);
	const description = stripHtml(mission.Description ?? '').trim();
	const briefing = (mission.StartVoiceline?.Text ?? '').trim();

	const missionType = mission.MissionType ?? '';
	const hasMissionTypeCategory = missionType.length > 0 && missionType !== 'None';

	// Voiceline-prefix → boss enemy + sequence. The prefix is the leading
	// token of StartVoiceline.ID; if it matches an enemy APIName/InternalName,
	// we infer this mission is a boss fight against that enemy.
	const prefix = voicelinePrefix(mission);
	const bossName = prefix ? (enemiesByLowercasedKey.get(prefix) ?? '') : '';
	const startId = mission.StartVoiceline?.ID ?? '';
	const voicelinesSection = buildVoicelinesSection(prefix, startId, localizationByPrefix);
	// If we have a multi-line sequence, suppress the standalone briefing —
	// the start line already appears in the sequence (marked as `(start)`).
	const sequenceLineCount = prefix ? (localizationByPrefix.get(prefix)?.length ?? 0) : 0;
	const showBriefing = briefing.length > 0 && sequenceLineCount < 2;

	return {
		name: escapeWikiText(missionPageTitle(mission)),
		pageTitle: missionPageTitle(mission),
		apiName: escapeWikiText(mission.ID),
		missionType,
		hasMissionTypeCategory,
		typeName: mission.TypeName ?? mission.MissionTypeName ?? '',
		colorHex: rgbaToHex(mission.Color),
		icon: `${displayFilename(mission)}_Icon.png`,
		minIntensity: mission.MinIntensity ?? 0,
		minLevelToStart: mission.MinLevelToStart ?? 0,
		expectedDurationMultiplier: mission.ExpectedDurationMultiplier ?? 1,
		missionXPMultiplier: mission.MissionXPMultiplier ?? 1,
		extractAtEnd: mission.ExtractAtEnd ? 'Yes' : 'No',
		selectable: mission.Selectable ? 'Yes' : 'No',
		flagsList: flagLabels.join(', '),
		flags: flagLabels,
		descriptionText: description,
		hasDescription: description.length > 0,
		briefingQuote: briefing,
		hasBriefing: showBriefing,
		bossName,
		hasBoss: bossName.length > 0,
		voicelinesSection,
		hasVoicelines: voicelinesSection.length > 0,
		stagesSection: stages.section,
		stageCount: stages.count,
		hasStages: stages.section.length > 0,
		rewardsSection: rewards,
		hasRewards: rewards.length > 0,
		relatedSection: related,
		hasRelated: related.length > 0,
		seoDescription: (
			description ||
			`${missionPageTitle(mission)}${mission.TypeName ? ` (${mission.TypeName})` : ''} mission in Mycopunk.`
		).slice(0, 280)
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const MISSION_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history', 'bugs'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set([
		'description',
		'briefing',
		'voicelines',
		'stages',
		'objectives',
		'rewards',
		'related',
		'overview'
	]),
	infoboxStripPattern: /\{\{Infobox mission[\s\S]*?\}\}/g
};

export function loadMissionGenerationData() {
	return {
		missions: loadMissions(),
		objectivesByName: loadObjectivesByName(),
		directivesByRef: loadDirectivesByMissionRef(),
		globalEventsByRef: loadGlobalEventsByMissionRef(),
		enemyNamesByKey: loadEnemyNamesByKey(),
		enemiesByLowercasedKey: loadEnemiesByLowercasedKey(),
		localizationByPrefix: loadLocalizationByPrefix(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
