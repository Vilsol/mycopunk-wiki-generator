// Shared LevelUnlockEntry rendering. Used by every entity that surfaces
// rewards/drops/unlocks (gears, enemies, threats, collectables).

import type { LevelUnlockEntry } from './data/schema.d';
import type { GenericGunUpgrade } from './upgrades/types';
import { stripHtml } from './wiki-text';
import { fmtPct } from './format-utils';

export interface DescribeRewardOptions {
	// When provided, `LevelUnlock_Upgrade` entries resolve their Upgrade ID to
	// the upgrade's display name and emit a `[[Name Upgrade|Name]]` wikilink.
	// When omitted, the raw ID is rendered as `Upgrade: <id>` (gear unlocks
	// historically did not surface upgrade names).
	upgradesByID?: Map<string, GenericGunUpgrade>;
	// Append `(NN% chance)` when Chance is set and < 1. Default: true.
	// Gears keep this off to preserve byte-identical output (their level-unlock
	// table never showed chance, and Chance=0 entries would otherwise misrender
	// as "(0% chance)").
	includeChance?: boolean;
}

// Render one LevelUnlockEntry as a wikitext string. Returns '' for entries
// the renderer doesn't recognise — caller should skip them.
export function describeLevelUnlock(u: LevelUnlockEntry, opts: DescribeRewardOptions = {}): string {
	const includeChance = opts.includeChance ?? true;
	const count = u.Count ?? 1;
	const countStr = count > 1 ? `${count}× ` : '';
	const chanceStr =
		includeChance && u.Chance !== undefined && u.Chance < 1 ? ` (${fmtPct(u.Chance)} chance)` : '';
	const rarityLabel = (r: string | undefined) => (!r || r === 'None' ? 'Random' : r);

	switch (u.Type) {
		case 'LevelUnlock_Resource':
			if (u.Resource) {
				const name = u.Resource.Resource ?? u.Resource.ResourceID ?? 'Unknown';
				const rc = u.Resource.Count ?? 0;
				const rcStr = rc > 0 ? `${rc} ` : '';
				return `${countStr}${rcStr}[[${name}]]${chanceStr}`;
			}
			return '';
		case 'LevelUnlock_UpgradeRarity':
			return `${countStr}${rarityLabel(u.Rarity)} upgrade${chanceStr}`;
		case 'LevelUnlock_SkinRarity':
			return `${countStr}${rarityLabel(u.Rarity)} skin${chanceStr}`;
		case 'LevelUnlock_RarityReward':
			return `${countStr}${rarityLabel(u.Rarity)} reward${chanceStr}`;
		case 'LevelUnlock_Upgrade': {
			if (!u.Upgrade) return '';
			const upgrade = opts.upgradesByID?.get(String(u.Upgrade));
			if (upgrade) {
				const name = stripHtml(upgrade.Name);
				return `${countStr}[[${name} Upgrade|${name}]]${chanceStr}`;
			}
			return `${countStr}Upgrade: ${u.Upgrade}${chanceStr}`;
		}
		case 'LevelUnlock_Skin':
		case 'LevelUnlock_SeededSkin':
			return `${countStr}Skin${u.Upgrade ? ` (${u.Upgrade})` : ''}${chanceStr}`;
		case 'LevelUnlock_LootPool':
			return `${countStr}Loot pool: ${u.LootPool ?? '(unknown)'}${chanceStr}`;
		case 'LevelUnlock_XP':
			return `${u.XP ?? 0} XP${chanceStr}`;
		case 'LevelUnlock_Gear':
			return u.Gear ? `Unlock gear: ${u.Gear}${chanceStr}` : '';
		case 'LevelUnlock_MultipleUpgrades':
			return `${countStr}upgrade${count > 1 ? 's' : ''} from a curated set${chanceStr}`;
		default:
			return '';
	}
}

// Render a flat (Reward-only) table. Returns '' if no entries describe.
export function buildRewardsTable(
	rewards: LevelUnlockEntry[] | undefined,
	opts: DescribeRewardOptions = {}
): string {
	if (!rewards || rewards.length === 0) return '';
	const out = ['{| class="wikitable"', '! Reward'];
	let any = false;
	for (const r of rewards) {
		const label = describeLevelUnlock(r, opts);
		if (!label) continue;
		out.push('|-');
		out.push(`| ${label}`);
		any = true;
	}
	if (!any) return '';
	out.push('|}');
	return out.join('\n');
}

// Render a Level | Reward table sorted by level. Used by gears for their
// LevelUnlocks display.
export function buildLevelUnlocksTable(
	unlocks: LevelUnlockEntry[] | undefined,
	opts: DescribeRewardOptions = {}
): string {
	if (!unlocks || unlocks.length === 0) return '';
	const sorted = [...unlocks].sort((a, b) => (a.Level ?? 0) - (b.Level ?? 0));
	const out = ['{| class="wikitable"', '! Level !! Reward'];
	let any = false;
	for (const u of sorted) {
		const label = describeLevelUnlock(u, opts);
		if (!label) continue;
		out.push('|-');
		out.push(`| ${u.Level ?? 0} || ${label}`);
		any = true;
	}
	if (!any) return '';
	out.push('|}');
	return out.join('\n');
}
