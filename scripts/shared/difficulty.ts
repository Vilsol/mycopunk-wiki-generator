// Shared difficulty/threat-scaling helpers used by the threat pages and the
// Game Mechanics page.

import type { PlayerScaled1, ThreatProfile } from './data/schema.d';
import { readDump } from './dump';
import { fmtNum, fmtPct } from './format-utils';

export const PLAYER_HEADERS = ['1 player', '2 players', '3 players', '4 players'];

// Enemy types in the order the game lists them (also the keys of
// `difficulty.EnemyHealthScaling`).
export const ENEMY_TYPES = ['Grunt', 'Brute', 'Abomination', 'Boss'];

export function getDifficulty() {
	return readDump().difficulty ?? {};
}

export function getThreatProfiles(): ThreatProfile[] {
	const profiles = (readDump().threatProfiles ?? {}) as Record<string, ThreatProfile>;
	return Object.values(profiles).sort((a, b) => a.Name.localeCompare(b.Name));
}

export function fmtMult(n: number | undefined): string {
	return n === undefined ? '—' : `×${fmtNum(n, 3)}`;
}

// "HighThreatMod" → "High Threat Mod"
export function humanize(key: string): string {
	return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

// One value per player count (1–4) plus the per-extra-player step, as wikitable cells.
export function playerCells(grid: PlayerScaled1 | undefined, fmt = fmtMult): string[] {
	const values = grid?.Values ?? [];
	const cells = PLAYER_HEADERS.map((_, i) => fmt(values[i]));
	const step = grid?.PerExtraPlayer;
	cells.push(step ? `+${fmtNum(step, 3)}` : '—');
	return cells;
}

// Additive profiles are chance offsets; the rest multiply the base value.
export function fmtProfileValue(profile: ThreatProfile, value: number | undefined): string {
	if (value === undefined) return '—';
	return profile.Additive ? `+${fmtPct(value)}` : fmtMult(value);
}
