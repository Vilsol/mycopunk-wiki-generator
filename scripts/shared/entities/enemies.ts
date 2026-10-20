// Enemy entity: loader, identification, stat/variant tables, registry.

import type { Enemy, EnemyPartPrefab, WeightedEntry } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName } from '../wiki-text';
import { defineEntity, lazyLoad } from '../entity-registry';
import { fmtNum, fmtPct } from '../format-utils';
import { buildRewardsTable } from '../reward-utils';
import { humanize } from '../difficulty';

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

// Arms rolled per spawn, listed by player count when it scales with the party.
function fmtArmCount(enemy: Enemy): string {
	const range = (r: { Min?: number; Max?: number }) =>
		r.Min === r.Max ? String(r.Min ?? 0) : `${r.Min ?? 0}–${r.Max ?? 0}`;
	const values = enemy.ArmCount?.Values ?? [];
	if (values.every((v) => !v.Max)) return '';
	const texts = values.map(range);
	if (new Set(texts).size === 1) return texts[0];
	return texts.map((t, i) => `${t} (${i + 1}P)`).join(', ');
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
	const armCount = fmtArmCount(enemy);
	if (armCount) rows.push({ label: 'Arm Count', value: armCount });
	if (enemy.LegHealthMultiplier !== undefined && enemy.LegHealthMultiplier !== 1)
		rows.push({ label: 'Leg Health Multiplier', value: fmtNum(enemy.LegHealthMultiplier, 2) });
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
// Body parts
// ─────────────────────────────────────────────────────────────────────────

type PartFields = Record<string, unknown>;

const getParts = lazyLoad(() => (readDump().enemyParts ?? {}) as Record<string, EnemyPartPrefab>);

// Fields of the part's health-bearing component, falling back to the first one.
function partFields(key: string): PartFields {
	const comps = getParts()[key]?.Components ?? [];
	return ((comps.find((c) => c.Fields?.maxHealth !== undefined) ?? comps[0])?.Fields ??
		{}) as PartFields;
}

function num(v: unknown): number | undefined {
	if (typeof v === 'number') return v;
	if (v && typeof v === 'object' && typeof (v as { Damage?: unknown }).Damage === 'number')
		return (v as { Damage: number }).Damage;
	return undefined;
}

function partName(key: string): string {
	return escapeWikiText(humanize(key));
}

function weighted(list: WeightedEntry[] | undefined): { key: string; chance: number }[] {
	const entries = (list ?? []).filter((e) => e.Key && e.Weight > 0);
	const total = entries.reduce((sum, e) => sum + e.Weight, 0);
	return entries.map((e) => ({ key: e.Key as string, chance: e.Weight / total }));
}

function table(headers: string[], rows: string[][]): string[] {
	const out = ['{| class="wikitable"', `! ${headers.join(' !! ')}`];
	for (const r of rows) {
		out.push('|-');
		out.push(`| ${r.join(' || ')}`);
	}
	out.push('|}');
	return out;
}

function fmtHealth(hp: number | undefined): string {
	return hp === undefined ? '—' : fmtNum(hp, 1);
}

function shellSummary(coreKey: string, enemy: Enemy): string {
	if (enemy.DontSpawnShellChildren) return '—';
	const children = partFields(coreKey).SpawnWithChildren;
	if (!Array.isArray(children) || children.length === 0) return '—';
	const counts = new Map<string, number>();
	for (const child of children as string[]) {
		const hp = num(partFields(child).maxHealth);
		const label = hp === undefined ? '?' : fmtNum(hp * (enemy.ShellHealthMultiplier ?? 1), 1);
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts].map(([hp, n]) => `${n}× ${hp} HP`).join(', ');
}

function armRow(key: string, chance: number): string[] {
	const arm = partFields(key);
	const tipKey = typeof arm.tipPrefab === 'string' ? arm.tipPrefab : undefined;
	const tipComp = tipKey ? getParts()[tipKey]?.Components?.[0] : undefined;
	const tip = tipKey ? partFields(tipKey) : {};
	const weapon = tipComp ? humanize(tipComp.Subclass.replace(/(ArmTip|Attachment)$/, '')) : '—';
	const interval = num(tip.fireInterval);
	return [
		partName(key),
		fmtPct(chance),
		weapon,
		fmtHealth(num(tip.maxHealth)),
		fmtNum(num(tip.damage)) || '—',
		interval ? fmtNum(interval, 2) : '—'
	];
}

function legRow(key: string, chance: number, enemy: Enemy): string[] {
	const leg = partFields(key);
	const segmentKey = typeof leg.legPartPrefab === 'string' ? leg.legPartPrefab : undefined;
	const segmentHp = segmentKey ? num(partFields(segmentKey).maxHealth) : undefined;
	const hp =
		segmentHp === undefined
			? undefined
			: segmentHp * (num(leg.healthMultiplier) ?? 1) * (enemy.LegHealthMultiplier ?? 1);
	return [
		partName(key),
		fmtPct(chance),
		fmtNum(num(leg.numLegParts)) || '—',
		fmtHealth(hp),
		leg.CanMelee ? fmtNum(num(leg.meleeDamage)) || '—' : '—',
		fmtNum(num(leg.ParentDamageOnDetach)) || '—'
	];
}

function buildBodyPartsSection(enemy: Enemy): string {
	const out: string[] = [];
	const add = (heading: string, lines: string[]) => {
		if (out.length > 0) out.push('');
		out.push(`=== ${heading} ===`, ...lines);
	};

	const cores = weighted(enemy.Cores);
	if (cores.length > 0)
		add(
			'Cores',
			table(
				['Core', 'Chance', 'Health', 'Shells'],
				cores.map((c) => [
					partName(c.key),
					fmtPct(c.chance),
					fmtHealth(num(partFields(c.key).maxHealth)),
					shellSummary(c.key, enemy)
				])
			)
		);

	const arms = weighted(enemy.Arms);
	if (arms.length > 0)
		add(
			'Arms',
			table(
				['Arm', 'Chance', 'Weapon', 'Weapon health', 'Damage', 'Fire interval (s)'],
				arms.map((a) => armRow(a.key, a.chance))
			)
		);

	const legs = weighted(enemy.Legs);
	if (legs.length > 0)
		add(
			'Legs',
			table(
				['Leg', 'Chance', 'Segments', 'Segment health', 'Melee damage', 'Body damage on detach'],
				legs.map((l) => legRow(l.key, l.chance, enemy))
			)
		);

	const groups = (enemy.AttachmentGroups ?? []).filter((g) => (g.Parts?.length ?? 0) > 0);
	if (groups.length > 0)
		add(
			'Attachments',
			table(
				['Chance', 'Count', 'Possible parts'],
				groups.map((g) => [
					fmtPct(g.Chance),
					g.Min === g.Max ? String(g.Min ?? 1) : `${g.Min ?? 1}–${g.Max ?? 1}`,
					weighted(g.Parts)
						.map((p) => {
							const hp = num(partFields(p.key).maxHealth);
							return `${partName(p.key)} (${fmtPct(p.chance)}${hp === undefined ? '' : `, ${fmtNum(hp, 1)} HP`})`;
						})
						.join('<br />')
				])
			)
		);

	if ((enemy.SpawnWithEnemy?.length ?? 0) > 0)
		add('Spawns with', [enemy.SpawnWithEnemy!.map((k) => `* ${partName(k)}`).join('\n')]);

	if (out.length === 0) return '';
	return [
		"''Base values, before [[Game Mechanics|threat and player-count scaling]]. Shell and leg health include this enemy's multipliers.''",
		'',
		...out
	].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Spawn pools + special waves
// ─────────────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Enemy name → raw IDs (several records can share one name).
const getIdsByName = lazyLoad(() => {
	const ids = new Map<string, Set<string>>();
	for (const [id, e] of Object.entries(readDump().enemies as Record<string, Enemy>)) {
		if (!e.Name?.trim()) continue;
		const set = ids.get(e.Name) ?? new Set<string>();
		set.add(id);
		ids.set(e.Name, set);
	}
	return ids;
});

function buildSpawnsSection(enemy: Enemy): string {
	const dump = readDump();
	const ids = getIdsByName().get(enemy.Name as string) ?? new Set<string>();
	const out: string[] = [];

	const rows: string[][] = [];
	for (const group of Object.values(dump.enemyGroups ?? {})) {
		const entries = group.Enemies ?? [];
		const total = entries.reduce((sum, e) => sum + e.Weight, 0);
		const weight = entries.filter((e) => ids.has(e.Enemy)).reduce((sum, e) => sum + e.Weight, 0);
		if (weight > 0) rows.push([titleCase(group.Name), fmtNum(weight), fmtPct(weight / total)]);
	}
	if (rows.length > 0) out.push(...table(['Spawn pool', 'Weight', 'Chance within pool'], rows));

	const waves = Object.values(dump.customWaves ?? {}).filter(
		(w) => w.SpecialEnemy !== undefined && ids.has(w.SpecialEnemy)
	);
	if (waves.length > 0) {
		if (out.length > 0) out.push('');
		for (const w of waves) {
			out.push(`* ${w.NumSpecialEnemies ?? 1}× opens the ${humanize(w.Name)}`);
		}
	}
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
	const partsSection = buildBodyPartsSection(enemy);
	const spawnsSection = buildSpawnsSection(enemy);

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
		partsSection,
		hasPartsSection: partsSection.length > 0,
		spawnsSection,
		hasSpawnsSection: spawnsSection.length > 0,
		limitSlots: enemy.EnemyLimitSlots !== undefined ? fmtNum(enemy.EnemyLimitSlots) : '',
		armCount: fmtArmCount(enemy),
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
	disambiguationLabel: () => 'Enemy',
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
		autoGenSections: [
			'stats',
			'statistics',
			'tags',
			'drops',
			'loot',
			'variants',
			'body parts',
			'spawns in',
			'overview'
		],
		infoboxTemplateName: 'Infobox enemy'
	},
	templateName: 'enemy-source.wiki',
	skeletonTemplateName: 'enemy-skeleton.wiki',
	contextBuilder: buildEnemyContext
	// fileTypes: [] — enemies have no Icon.Texture in the dump yet.
});
