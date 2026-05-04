// Enemy entity: loader, identification, stat/variant tables, registry.

import type { Enemy } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName } from '../wiki-text';
import { defineEntity, lazyLoad } from '../entity-registry';
import { fmtNum, fmtPct } from '../format-utils';
import { buildRewardsTable } from '../reward-utils';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

function loadRawEnemies(): Enemy[] {
	const data = readDump() as unknown as { enemies?: Record<string, Enemy> };
	if (!data?.enemies || typeof data.enemies !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with an 'enemies' property`);
	}
	// Junk entries (TestBrute, //:ERROR://, ID=0 legacy duplicates) are now
	// dropped at dump time — see Santa update v1.8.1H1+. Just require a Name.
	return Object.values(data.enemies).filter((e) => (e.Name ?? '').trim().length > 0);
}

// Score for picking the canonical variant when an enemy Name has multiple
// records: prefer entries that carry CustomLoot, then those with non-empty Tags.
function variantScore(e: Enemy): number {
	let s = 0;
	if ((e.CustomLoot?.length ?? 0) > 0) s += 100;
	const tags = (e.Tags ?? '').trim();
	if (tags && tags !== 'None') s += 10;
	return s;
}

// Stable fingerprint of the gameplay-relevant fields. Two enemies with the same
// fingerprint are treated as exact duplicates (not separate variants).
export function variantFingerprint(e: Enemy): string {
	const c = e.Config ?? {};
	const parts = [
		(e.Tags ?? '').trim(),
		e.MinLegs ?? '',
		e.MaxLegs ?? '',
		e.ArmChance ?? '',
		e.ShellHealthMultiplier ?? '',
		e.OverclockChance ?? '',
		c.MoveSpeed ?? '',
		c.TurnSpeed ?? '',
		c.NavRadius ?? '',
		c.HitStunChance ?? '',
		c.RagdollForceThreshold ?? '',
		c.FlankChance ?? '',
		c.MaxConcurrentMeleeAttacks ?? '',
		c.MeleeInterval ?? '',
		c.RegrowLimbDuration ?? '',
		c.RegrowLimbCooldown ?? '',
		(e.CustomLoot?.length ?? 0) > 0 ? 'L' : ''
	];
	return parts.join('|');
}

// Group enemies by Name. Within each group, dedup by fingerprint so identical
// records (e.g. 3 of the 5 "Brute" entries) collapse, but genuine variants
// (e.g. the Exploder Brute) are preserved as separate entries.
export function loadEnemyGroups(): Map<string, Enemy[]> {
	const groups = new Map<string, Enemy[]>();
	for (const e of loadRawEnemies()) {
		const name = e.Name as string;
		const list = groups.get(name) ?? [];
		list.push(e);
		groups.set(name, list);
	}
	for (const [name, list] of groups) {
		const seen = new Map<string, Enemy>();
		for (const e of list) {
			const fp = variantFingerprint(e);
			const prior = seen.get(fp);
			if (!prior || variantScore(e) > variantScore(prior)) seen.set(fp, e);
		}
		const unique = [...seen.values()].sort((a, b) => variantScore(b) - variantScore(a));
		groups.set(name, unique);
	}
	return groups;
}

export function loadEnemies(): Enemy[] {
	return [...loadEnemyGroups().values()].map((variants) => variants[0]);
}

function fallbackName(enemy: Enemy): string {
	return enemy.APIName || enemy.InternalName || `enemy_${enemy.ID}`;
}

export function safeFilename(enemy: Enemy): string {
	const base = enemy.APIName || enemy.InternalName;
	if (!base || !/[a-zA-Z0-9]/.test(base)) return `enemy_${enemy.ID}`;
	return sanitizeAPIName(base);
}

export function displayFilename(enemy: Enemy): string {
	const name = enemy.Name || fallbackName(enemy);
	if (!/[a-zA-Z0-9]/.test(name)) return `enemy_${enemy.ID}`;
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function enemyPageTitle(enemy: Enemy): string {
	return enemy.Name || fallbackName(enemy);
}

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
// Variants table
// ─────────────────────────────────────────────────────────────────────────

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

const ENEMY_TYPE_CATEGORY: Record<string, string> = {
	Grunt: 'Grunts',
	Brute: 'Brutes',
	Abomination: 'Abominations',
	Boss: 'Bosses'
};

const getGroups = lazyLoad(loadEnemyGroups);

export function buildEnemyContext(enemy: Enemy): Record<string, unknown> {
	const variants = getGroups().get(enemy.Name as string) ?? [enemy];
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

export function loadEnemyGenerationData() {
	return {
		enemies: loadEnemies(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Enemy>({
	name: 'enemies',
	dumpKey: 'enemies',
	loadItems: loadEnemies,
	safeFilename,
	displayFilename,
	pageTitle: enemyPageTitle,
	identLabel: (e) => `${e.APIName ?? e.InternalName} (ID: ${e.ID})`,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: [
			'lore',
			'strategy',
			'tips',
			'trivia',
			'notes',
			'bugs',
			'patch history',
			'changelog'
		],
		autoGenSections: ['stats', 'statistics', 'tags', 'drops', 'loot', 'variants', 'overview'],
		infoboxTemplateName: 'Infobox enemy'
	},
	templateName: 'enemy-source.wiki',
	skeletonTemplateName: 'enemy-skeleton.wiki',
	contextBuilder: buildEnemyContext
	// fileTypes: [] — enemies have no Icon.Texture in the dump yet.
});
