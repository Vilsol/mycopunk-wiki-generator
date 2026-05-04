import type { Enemy } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

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
		// Sort variants so the canonical (richest) entry is first.
		const unique = [...seen.values()].sort((a, b) => variantScore(b) - variantScore(a));
		groups.set(name, unique);
	}
	return groups;
}

export function loadEnemies(): Enemy[] {
	// Canonical entry per name = the first (richest) of its deduped variants.
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
