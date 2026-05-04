// Enemy entity: formatter context, tag/region rendering, custom-loot table.
// Generation script and uploader both pull from this module.

import type { Enemy } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText } from '../wiki-text';
import {
	loadEnemies,
	loadEnemyGroups,
	displayFilename,
	enemyPageTitle,
	safeFilename
} from '../load-enemies';
import type { EntityClassifierConfig } from '../upload-pipeline';
import { fmtNum, fmtPct } from './format-utils';
import { buildRewardsTable } from './reward-utils';

export { loadEnemies, loadEnemyGroups, displayFilename, enemyPageTitle, safeFilename };

// ─────────────────────────────────────────────────────────────────────────
// Tag / type rendering
// ─────────────────────────────────────────────────────────────────────────

function splitFlags(s: string | undefined): string[] {
	if (!s) return [];
	return s
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t && t !== 'None' && t !== '0');
}

// ─────────────────────────────────────────────────────────────────────────
// Stats table
// ─────────────────────────────────────────────────────────────────────────

interface StatRow {
	label: string;
	value: string;
}

function extractStatRows(enemy: Enemy): StatRow[] {
	const rows: StatRow[] = [];
	const c = enemy.Config ?? {};
	if (c.MoveSpeed !== undefined) rows.push({ label: 'Move Speed', value: fmtNum(c.MoveSpeed) });
	if (c.TurnSpeed !== undefined)
		rows.push({ label: 'Turn Speed (deg/s)', value: fmtNum(c.TurnSpeed) });
	if (c.NavRadius !== undefined) rows.push({ label: 'Nav Radius', value: fmtNum(c.NavRadius) });
	if (c.HitStunChance !== undefined && c.HitStunChance > 0)
		rows.push({ label: 'Hit Stun Chance', value: fmtPct(c.HitStunChance) });
	if (c.RagdollForceThreshold !== undefined)
		rows.push({
			label: 'Ragdoll Force Threshold',
			value: fmtNum(c.RagdollForceThreshold)
		});
	if (c.FlankChance !== undefined && c.FlankChance > 0)
		rows.push({ label: 'Flank Chance', value: fmtPct(c.FlankChance) });
	if (c.MaxConcurrentMeleeAttacks !== undefined && c.MaxConcurrentMeleeAttacks > 0)
		rows.push({
			label: 'Max Concurrent Melee Attacks',
			value: fmtNum(c.MaxConcurrentMeleeAttacks)
		});
	if (c.MeleeInterval !== undefined && c.MeleeInterval > 0)
		rows.push({ label: 'Melee Interval (s)', value: fmtNum(c.MeleeInterval, 2) });
	if (c.RegrowLimbDuration !== undefined && c.RegrowLimbDuration > 0)
		rows.push({ label: 'Regrow Limb Duration (s)', value: fmtNum(c.RegrowLimbDuration, 2) });
	if (c.RegrowLimbCooldown !== undefined && c.RegrowLimbCooldown > 0)
		rows.push({ label: 'Regrow Limb Cooldown (s)', value: fmtNum(c.RegrowLimbCooldown, 2) });
	if (enemy.ShellHealthMultiplier !== undefined && enemy.ShellHealthMultiplier !== 1)
		rows.push({ label: 'Shell Health Multiplier', value: fmtNum(enemy.ShellHealthMultiplier, 2) });
	if (enemy.OverclockChance !== undefined && enemy.OverclockChance < 1)
		rows.push({ label: 'Overclock Chance', value: fmtPct(enemy.OverclockChance) });
	if (enemy.MinLegs !== undefined || enemy.MaxLegs !== undefined) {
		const min = enemy.MinLegs ?? 0;
		const max = enemy.MaxLegs ?? min;
		const value = min === max ? String(min) : `${min}–${max}`;
		if (value !== '0') rows.push({ label: 'Legs', value });
	}
	if (enemy.ArmChance !== undefined && enemy.ArmChance > 0)
		rows.push({ label: 'Arm Chance', value: fmtPct(enemy.ArmChance) });
	return rows;
}

function buildStatsTable(enemy: Enemy): string {
	const rows = extractStatRows(enemy);
	if (rows.length === 0) return '';
	const out = ['{| class="wikitable"', '! Stat !! Value'];
	for (const r of rows) {
		out.push('|-');
		out.push(`| ${r.label} || ${r.value}`);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Variants table — surfaces genuinely-different stat profiles for enemy names
// that have multiple records (e.g. the 4 distinct "Grunt" loadouts).
// ─────────────────────────────────────────────────────────────────────────

// Stat columns rendered for each variant. Picked to maximise differentiation:
// every Grunt/Brute/Abomination variant differs in at least one of these.
const VARIANT_STAT_COLUMNS: Array<{
	label: string;
	get: (e: Enemy) => number | undefined;
	pct?: boolean;
}> = [
	{ label: 'Move Speed', get: (e) => e.Config?.MoveSpeed },
	{ label: 'Ragdoll', get: (e) => e.Config?.RagdollForceThreshold },
	{ label: 'Hit Stun', get: (e) => e.Config?.HitStunChance, pct: true },
	{ label: 'Shell HP', get: (e) => e.ShellHealthMultiplier },
	{ label: 'Arm %', get: (e) => e.ArmChance, pct: true },
	{ label: 'Overclock', get: (e) => e.OverclockChance, pct: true }
];

function buildVariantsTable(variants: Enemy[]): string {
	// Build display rows, then dedupe on the visible content. Two records may
	// fingerprint differently (e.g. differ only in FlankChance) but render the
	// same row in the displayed columns — collapse those.
	const seen = new Set<string>();
	const rows: string[] = [];
	for (const v of variants) {
		const label = splitFlags(v.Tags).join(', ') || 'Default';
		const cells = VARIANT_STAT_COLUMNS.map((c) => {
			const n = c.get(v);
			if (n === undefined || !Number.isFinite(n)) return '—';
			return c.pct ? fmtPct(n) : fmtNum(n);
		});
		const row = `| ${label} || ${v.Tags || 'None'} || ${cells.join(' || ')}`;
		if (seen.has(row)) continue;
		seen.add(row);
		rows.push(row);
	}
	if (rows.length < 2) return '';
	const out = [
		'{| class="wikitable sortable"',
		`! Variant !! Tags !! ${VARIANT_STAT_COLUMNS.map((c) => c.label).join(' !! ')}`
	];
	for (const r of rows) {
		out.push('|-');
		out.push(r);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

// Manual map for category names — `<type>s` over-pluralizes "Boss" → "Bosss".
const ENEMY_TYPE_CATEGORY: Record<string, string> = {
	Grunt: 'Grunts',
	Brute: 'Brutes',
	Abomination: 'Abominations',
	Boss: 'Bosses'
};

export function buildEnemyContext(
	enemy: Enemy,
	variants: Enemy[] = [enemy]
): Record<string, unknown> {
	const tags = splitFlags(enemy.Tags);
	const enemyType = enemy.Config?.EnemyType ?? '';
	const lootSection = buildRewardsTable(enemy.CustomLoot);
	const variantsSection = buildVariantsTable(variants);

	return {
		typeCategory: ENEMY_TYPE_CATEGORY[enemyType] ?? (enemyType ? `${enemyType}s` : ''),
		name: escapeWikiText(enemy.Name ?? enemy.APIName ?? enemy.InternalName ?? ''),
		pageTitle: enemyPageTitle(enemy),
		apiName: escapeWikiText(enemy.APIName ?? enemy.InternalName ?? ''),
		internalName: escapeWikiText(enemy.InternalName ?? ''),
		enemyType,
		tags,
		tagsText: tags.join(', '),
		seoDescription: `${enemy.Name ?? 'Unknown'}${enemyType ? ` (${enemyType})` : ''} enemy in Mycopunk.`,
		statsSection: buildStatsTable(enemy),
		lootSection,
		hasLootSection: lootSection.length > 0,
		hasStatsSection: buildStatsTable(enemy).length > 0,
		variantsSection,
		hasVariantsSection: variantsSection.length > 0,
		canBeDespawned: enemy.CanBeDespawned ? 'Yes' : 'No'
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config
// ─────────────────────────────────────────────────────────────────────────

export const ENEMY_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'strategy', 'tips', 'trivia', 'notes', 'bugs', 'patch history', 'changelog'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set([
		'stats',
		'statistics',
		'tags',
		'drops',
		'loot',
		'variants',
		'overview'
	]),
	infoboxStripPattern: /\{\{Infobox enemy[\s\S]*?\}\}/g
};

export function loadEnemyGenerationData() {
	return {
		enemies: loadEnemies(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
