// Progression singleton ("Player Level"): level-milestone unlocks, XP curves,
// mission XP formula and upgrade-grid growth. Wrapped in a one-element array
// so it plugs into the per-entity pipeline like `crafting`.

import type { Formulas, GridProfileEntry, LevelMilestoneEntry } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity } from '../entity-registry';
import { escapeWikiText, plainText } from '../wiki-text';
import { loadMissions, missionPageTitle } from './missions';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

export interface ProgressionSingleton {
	id: 'progression';
	levelMilestones: LevelMilestoneEntry[];
	formulas: Formulas;
	gridProfiles: Record<string, GridProfileEntry>;
}

export function loadProgression(): ProgressionSingleton[] {
	const data = readDump() as unknown as {
		levelMilestones?: LevelMilestoneEntry[];
		formulas?: Formulas;
		gridProfiles?: Record<string, GridProfileEntry>;
	};
	if (!data.levelMilestones || !data.formulas || !data.gridProfiles) {
		throw new Error(`Invalid data.json shape: expected levelMilestones, formulas and gridProfiles`);
	}
	return [
		{
			id: 'progression',
			levelMilestones: data.levelMilestones,
			formulas: data.formulas,
			gridProfiles: data.gridProfiles
		}
	];
}

export function safeFilename(): string {
	return 'progression';
}

export function displayFilename(): string {
	return 'Player_Level';
}

export function progressionPageTitle(): string {
	return 'Player Level';
}

// ─────────────────────────────────────────────────────────────────────────
// Level unlocks
// ─────────────────────────────────────────────────────────────────────────

// Mission milestones ("Mission: <color>Ouroboros</color>") link to the
// mission page when one exists under that title.
function milestoneLabel(raw: string, missionTitles: ReadonlySet<string>): string {
	const label = plainText(raw).trim();
	const m = label.match(/^Mission:\s*(.+)$/);
	if (m && missionTitles.has(m[1])) return `Mission: [[${m[1]}]]`;
	return escapeWikiText(label);
}

function buildMilestonesTable(milestones: LevelMilestoneEntry[]): string {
	const missionTitles = new Set(loadMissions().map(missionPageTitle));
	const out = ['{| class="wikitable"', '! Level !! Unlocks'];
	for (const ms of [...milestones].sort((a, b) => (a.Level ?? 0) - (b.Level ?? 0))) {
		const items = (ms.Items ?? []).map((i) => milestoneLabel(i.Label ?? '', missionTitles));
		out.push('|-');
		out.push(`| ${ms.Level} || ${items.join('<br>')}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// XP curves
// ─────────────────────────────────────────────────────────────────────────

type XPCurve = NonNullable<Formulas['XPCurves']>[number];

// Offset-0 curves take (level+1) as input, offset curves take (level-offset),
// matching the in-game curve descriptions.
function curveXP(curve: XPCurve, level: number): number {
	const offset = curve.LevelOffset ?? 0;
	const input = offset === 0 ? level + 1 : level - offset;
	return Math.round(curve.Coefficient * Math.pow(input, curve.Power) + curve.Add);
}

function xpAtLevel(curves: XPCurve[], prefix: string, level: number): number | null {
	const forPrefix = curves.filter((c) => c.Context.startsWith(`${prefix}_`));
	// Curves are ordered by bracket; the last one whose offset the level reaches
	// applies (this makes the curves join up: 10 -> 2138 then 2137 + 60*(L-10)^1.5).
	const curve = [...forPrefix].reverse().find((c) => level >= (c.LevelOffset ?? 0));
	return curve ? curveXP(curve, level) : null;
}

const XP_TABLE_LEVELS = 20;

function buildCurvesTable(curves: XPCurve[]): string {
	const out = ['{| class="wikitable"', '! Curve !! Formula'];
	for (const c of curves) {
		out.push('|-');
		out.push(
			`| <code>${escapeWikiText(c.Context)}</code> || ${escapeWikiText(c.Description ?? '')}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

function buildXPTable(curves: XPCurve[]): string {
	const out = [
		'{| class="wikitable"',
		'! Current level !! Character XP to next level !! Gear XP to next level'
	];
	for (let level = 1; level <= XP_TABLE_LEVELS; level++) {
		const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
		out.push('|-');
		out.push(
			`| ${level} || ${fmt(xpAtLevel(curves, 'character', level))} || ${fmt(xpAtLevel(curves, 'gear', level))}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Upgrade-grid growth
// ─────────────────────────────────────────────────────────────────────────

// Per-profile level→size list rendered as "Level N: W×H" rows.
export function buildGridGrowthTable(profile: GridProfileEntry | undefined): string {
	const sizes = profile?.GridSizes ?? [];
	if (sizes.length === 0) return '';
	const out = ['{| class="wikitable"', '! From player level !! Upgrade grid'];
	for (const s of sizes) {
		out.push('|-');
		out.push(`| ${s.Level ?? 0} || ${s.Width}×${s.Height}`);
	}
	out.push('|}');
	return out.join('\n');
}

export function loadDefaultGridProfile(): GridProfileEntry | undefined {
	return loadProgression()[0].gridProfiles.DefaultGridProfile;
}

const GRID_PROFILE_LABELS: Record<string, string> = {
	DefaultGridProfile: 'Default',
	HeavyGridProfile: 'Heavy',
	BrokenFrameGrid: 'Broken Frame'
};

function buildGridProfilesTable(profiles: Record<string, GridProfileEntry>): string {
	const names = Object.keys(profiles).sort();
	const levels = [
		...new Set(names.flatMap((n) => (profiles[n].GridSizes ?? []).map((s) => s.Level ?? 0)))
	].sort((a, b) => a - b);
	const out = [
		'{| class="wikitable"',
		`! Player level ${names.map((n) => `!! ${GRID_PROFILE_LABELS[n] ?? n}`).join(' ')}`
	];
	for (const level of levels) {
		const cells = names.map((n) => {
			const sizes = (profiles[n].GridSizes ?? []).filter((s) => (s.Level ?? 0) <= level);
			const s = sizes[sizes.length - 1];
			return s ? `${s.Width}×${s.Height}` : '—';
		});
		out.push('|-');
		out.push(`| ${level} || ${cells.join(' || ')}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildProgressionContext(p: ProgressionSingleton): Record<string, unknown> {
	const curves = p.formulas.XPCurves ?? [];
	return {
		name: progressionPageTitle(),
		pageTitle: progressionPageTitle(),
		seoDescription: 'Player level unlocks, XP curves and upgrade grid growth in Mycopunk.',
		milestonesSection: buildMilestonesTable(p.levelMilestones),
		curvesSection: buildCurvesTable(curves),
		xpSection: buildXPTable(curves),
		xpTableLevels: XP_TABLE_LEVELS,
		missionXP: escapeWikiText(p.formulas.MissionXP ?? ''),
		gridSection: buildGridProfilesTable(p.gridProfiles)
	};
}

export function loadProgressionGenerationData() {
	return {
		progression: loadProgression(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<ProgressionSingleton>({
	name: 'progression',
	dumpKey: 'levelMilestones', // singleton — loadProgression combines several top-level keys
	loadItems: loadProgression,
	safeFilename,
	displayFilename,
	pageTitle: progressionPageTitle,
	identLabel: () => 'progression',
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'strategy', 'tips', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['level unlocks', 'xp curves', 'upgrade grid', 'mission xp'],
		infoboxTemplateName: 'Infobox progression'
	},
	templateName: 'progression-source.wiki',
	skeletonTemplateName: 'progression-skeleton.wiki',
	contextBuilder: buildProgressionContext
	// no fileTypes — no icon
});
