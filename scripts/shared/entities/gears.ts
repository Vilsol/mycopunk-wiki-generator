// Gear entity: formatter context, compatible-upgrade inversion, stat
// extraction from `RawData.gunData`. Generation script and uploader both
// pull from this module.

import type { Gear } from '../data/schema.d';
import type { GenericGunUpgrade } from '../upgrades/types';
import { readDump } from '../dump';
import { descriptionToWiki, escapeWikiText, stripHtml } from '../wiki-text';
import { loadGears, displayFilename, gearPageTitle } from '../load-gears';
import { loadUpgrades, mapGunName } from '../load-upgrades';
import { loadSkins, skinPageTitle, variantPreviewFilename, type Skin } from '../load-skins';
import type { EntityClassifierConfig } from '../upload-pipeline';
import { fmtNum } from './format-utils';
import { buildLevelUnlocksTable } from './reward-utils';

export { loadGears, displayFilename, gearPageTitle };
export { safeFilename } from '../load-gears';

// ─────────────────────────────────────────────────────────────────────────
// Compatible-upgrade inversion
// ─────────────────────────────────────────────────────────────────────────
// Each upgrade lists the gears it applies to via `ApplicableTo[].APIName`.
// We invert that index so a gear page can list every upgrade that can be
// equipped on it.

export interface UpgradesByGear {
	upgrades: Map<string, GenericGunUpgrade[]>; // keyed by gear APIName
	skins: Map<string, GenericGunUpgrade[]>;
}

export function loadUpgradesByGear(): UpgradesByGear {
	const upgrades = new Map<string, GenericGunUpgrade[]>();
	const skins = new Map<string, GenericGunUpgrade[]>();
	for (const u of loadUpgrades()) {
		const target = u.UpgradeType === 'Cosmetic' ? skins : upgrades;
		for (const ap of u.ApplicableTo ?? []) {
			const apiName = ap.APIName ?? '';
			if (!apiName) continue;
			const list = target.get(apiName) ?? [];
			list.push(u);
			target.set(apiName, list);
		}
	}
	for (const m of [upgrades, skins]) {
		for (const list of m.values()) {
			list.sort((a, b) => a.Name.localeCompare(b.Name));
		}
	}
	return { upgrades, skins };
}

// ─────────────────────────────────────────────────────────────────────────
// Gun stats extraction
// ─────────────────────────────────────────────────────────────────────────

// Subset of the unityesque gunData blob we actually surface on the wiki.
// Untyped because the dump's `RawData` is `Record<string, unknown>`.
// damageEffect enum values found in the dump (verified from gear descriptions):
//   0 = None (Normal), 1 = Fire, 2 = Shock, 3 = Acid
// Bees (4) doesn't appear on any gear's gunData — they come from upgrades.
const DAMAGE_EFFECT_NAMES: Record<number, string> = {
	0: 'Normal',
	1: 'Fire',
	2: 'Shock',
	3: 'Acid'
};

interface GunDataLike {
	damage?: number;
	damageEffect?: number;
	damageEffectAmount?: number;
	bulletSpeed?: number;
	bulletGravity?: number;
	fireInterval?: number;
	bulletsPerShot?: number;
	burstSize?: number;
	burstFireInterval?: number;
	magazineSize?: number;
	hasLimitedAmmo?: boolean;
	ammoCapacity?: number;
	reloadDuration?: number;
	maxBounces?: number;
	hitVFXSize?: number;
	rangeData?: {
		falloffStartDistance?: number;
		falloffEndDistance?: number;
		maxDamageRange?: number;
		maxFalloffDamageMultiplier?: number;
	};
	recoilData?: {
		recoilX?: { x?: number; y?: number };
		recoilY?: { x?: number; y?: number };
	};
	spreadData?: { spreadSize?: { x?: number; y?: number } };
	chargeData?: { duration?: number };
}

function getGunData(gear: Gear): GunDataLike | null {
	const raw = gear.RawData as { gunData?: GunDataLike } | undefined;
	return raw?.gunData ?? null;
}

interface StatRow {
	label: string;
	value: string;
}

function extractGunStatRows(gd: GunDataLike): StatRow[] {
	const rows: StatRow[] = [];
	if (gd.damage !== undefined) rows.push({ label: 'Damage', value: fmtNum(gd.damage) });
	if (gd.damageEffect !== undefined) {
		const name = DAMAGE_EFFECT_NAMES[gd.damageEffect] ?? String(gd.damageEffect);
		rows.push({ label: 'Element', value: name });
		if (gd.damageEffectAmount !== undefined && name !== 'Normal') {
			rows.push({ label: 'Element Amount', value: fmtNum(gd.damageEffectAmount, 2) });
		}
	}
	if (gd.bulletsPerShot && gd.bulletsPerShot > 1)
		rows.push({ label: 'Bullets per Shot', value: fmtNum(gd.bulletsPerShot) });
	if (gd.burstSize && gd.burstSize > 1) {
		rows.push({ label: 'Burst Size', value: fmtNum(gd.burstSize) });
		if (gd.burstFireInterval !== undefined)
			rows.push({ label: 'Burst Interval (s)', value: fmtNum(gd.burstFireInterval, 3) });
	}
	if (gd.fireInterval && gd.fireInterval > 0) {
		const rpm = 60 / gd.fireInterval;
		rows.push({ label: 'Fire Rate (RPM)', value: fmtNum(rpm, 0) });
		rows.push({ label: 'Fire Interval (s)', value: fmtNum(gd.fireInterval, 3) });
	}
	if (gd.magazineSize !== undefined)
		rows.push({ label: 'Magazine Size', value: fmtNum(gd.magazineSize) });
	if (gd.hasLimitedAmmo && gd.ammoCapacity !== undefined)
		rows.push({ label: 'Ammo Capacity', value: fmtNum(gd.ammoCapacity) });
	if (gd.reloadDuration !== undefined)
		rows.push({ label: 'Reload Duration (s)', value: fmtNum(gd.reloadDuration, 2) });
	if (gd.bulletSpeed !== undefined)
		rows.push({ label: 'Bullet Speed', value: fmtNum(gd.bulletSpeed) });
	if (gd.bulletGravity !== undefined && gd.bulletGravity !== 0)
		rows.push({ label: 'Bullet Gravity', value: fmtNum(gd.bulletGravity) });
	if (gd.maxBounces && gd.maxBounces > 0)
		rows.push({ label: 'Max Bounces', value: fmtNum(gd.maxBounces) });
	if (gd.chargeData?.duration && gd.chargeData.duration > 0)
		rows.push({ label: 'Charge Time (s)', value: fmtNum(gd.chargeData.duration, 2) });

	const rd = gd.rangeData;
	if (rd) {
		if (rd.falloffStartDistance !== undefined)
			rows.push({ label: 'Falloff Start (m)', value: fmtNum(rd.falloffStartDistance) });
		if (rd.falloffEndDistance !== undefined)
			rows.push({ label: 'Falloff End (m)', value: fmtNum(rd.falloffEndDistance) });
		if (rd.maxDamageRange !== undefined)
			rows.push({ label: 'Max Damage Range (m)', value: fmtNum(rd.maxDamageRange) });
		if (rd.maxFalloffDamageMultiplier !== undefined)
			rows.push({
				label: 'Max Falloff Damage Multiplier',
				value: fmtNum(rd.maxFalloffDamageMultiplier, 2)
			});
	}

	const spread = gd.spreadData?.spreadSize;
	if (spread) {
		if (spread.x !== undefined)
			rows.push({ label: 'Spread (Horizontal)', value: fmtNum(spread.x, 2) });
		if (spread.y !== undefined)
			rows.push({ label: 'Spread (Vertical)', value: fmtNum(spread.y, 2) });
	}

	const recoil = gd.recoilData;
	if (recoil) {
		if (recoil.recoilX) {
			rows.push({
				label: 'Recoil X',
				value: `${fmtNum(recoil.recoilX.x, 2)} – ${fmtNum(recoil.recoilX.y, 2)}`
			});
		}
		if (recoil.recoilY) {
			rows.push({
				label: 'Recoil Y',
				value: `${fmtNum(recoil.recoilY.x, 2)} – ${fmtNum(recoil.recoilY.y, 2)}`
			});
		}
	}

	return rows;
}

function buildStatsTable(gear: Gear): string {
	const gd = getGunData(gear);
	if (!gd) return '';
	const rows = extractGunStatRows(gd);
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
// Compatible-upgrade tables
// ─────────────────────────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
	Standard: 'green',
	Rare: 'cornflowerblue',
	Epic: 'magenta',
	Exotic: 'orange',
	Oddity: 'red',
	Contraband: 'purple'
};

// Power order so a sortable table sorts by rarity tier, not alphabetically.
// Standard < Rare < Epic < Exotic < Oddity < Contraband. Anything not on the
// list sorts last via a sentinel.
const RARITY_ORDER: Record<string, number> = {
	Standard: 1,
	Rare: 2,
	Epic: 3,
	Exotic: 4,
	Oddity: 5,
	Contraband: 6
};

// Returns a wiki-table cell *body* prefixed with `data-sort-value="N" | ` so
// MediaWiki's sortable plugin uses the numeric tier as the sort key while the
// visible text is the coloured rarity span. Insert as `|| ${rarityCell(...)}`.
function rarityCell(rarity: string): string {
	const order = RARITY_ORDER[rarity] ?? 99;
	const color = RARITY_COLORS[rarity];
	const inner = color ? `<span style="color:${color}">${rarity}</span>` : rarity;
	return `data-sort-value="${order}" | ${inner}`;
}

function buildUpgradesTable(upgrades: GenericGunUpgrade[]): string {
	if (upgrades.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Name !! Rarity !! Description'];
	for (const u of upgrades) {
		const name = stripHtml(u.Name);
		const desc = stripHtml(u.Description ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		out.push('|-');
		out.push(`| [[${name} Upgrade|${name}]] || ${rarityCell(u.Rarity)} || ${desc}`);
	}
	out.push('|}');
	return out.join('\n');
}

// Index of Skin entries by upgrade ID so the table can link each row to its
// dedicated skin page (with thumbnail) instead of a non-existent
// `[[<Name> Upgrade]]`.
function loadSkinsByID(): Map<string, Skin> {
	const out = new Map<string, Skin>();
	for (const s of loadSkins()) out.set(String(s.upgrade.ID), s);
	return out;
}

function basePreviewThumb(s: Skin, gearAPIName: string): string {
	const previews = s.skin.Previews ?? {};
	// Prefer this gear's own previews if present, otherwise fall back to any
	// available parent (universal skins always have an entry for this gear,
	// but stay defensive in case the dump ever lists ApplicableTo without
	// a matching Previews entry).
	const parent = previews[gearAPIName] ? gearAPIName : Object.keys(previews)[0];
	if (!parent) return '';
	const variants = previews[parent] ?? {};
	const preset = 'base' in variants ? 'base' : Object.keys(variants)[0];
	if (!preset) return '';
	const file = variantPreviewFilename(s, parent, preset, 'jpg');
	return `[[File:${file}|60px|link=${skinPageTitle(s)}]]`;
}

function buildSkinsTable(skins: GenericGunUpgrade[], gearAPIName: string): string {
	if (skins.length === 0) return '';
	const skinsByID = loadSkinsByID();
	// Dedupe by skin page title — multiple cosmetic upgrade IDs can resolve to
	// the same skin page (rarity dupes, redrops). Keep the one with the most
	// variants for *this* gear.
	const byPage = new Map<string, Skin>();
	for (const u of skins) {
		const found = skinsByID.get(String(u.ID));
		if (!found) continue;
		const title = skinPageTitle(found);
		const prior = byPage.get(title);
		const foundCount = Object.keys((found.skin.Previews ?? {})[gearAPIName] ?? {}).length;
		const priorCount = prior
			? Object.keys((prior.skin.Previews ?? {})[gearAPIName] ?? {}).length
			: -1;
		if (!prior || foundCount > priorCount) byPage.set(title, found);
	}
	if (byPage.size === 0) return '';

	const matched = [...byPage.values()].sort((a, b) =>
		stripHtml(a.upgrade.Name ?? '').localeCompare(stripHtml(b.upgrade.Name ?? ''))
	);

	const out = ['{| class="wikitable sortable"', '! Preview !! Name !! Rarity !! Variants'];
	for (const s of matched) {
		const name = stripHtml(s.upgrade.Name ?? '');
		const variants = (s.skin.Previews ?? {})[gearAPIName] ?? {};
		const variantCount = Object.keys(variants).length;
		out.push('|-');
		out.push(
			`| ${basePreviewThumb(s, gearAPIName) || '—'} || [[${skinPageTitle(s)}|${name}]] || ${rarityCell(s.upgrade.Rarity)} || ${variantCount || '—'}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

export function buildGearContext(
	gear: Gear,
	upgradesByGear: UpgradesByGear
): Record<string, unknown> {
	const baseGrid = gear.GridSizes?.[0];
	const gridSize =
		baseGrid && baseGrid.Width && baseGrid.Height ? `${baseGrid.Width}×${baseGrid.Height}` : '';

	const compatibleUpgrades = upgradesByGear.upgrades.get(gear.APIName) ?? [];
	const compatibleSkins = upgradesByGear.skins.get(gear.APIName) ?? [];
	const gd = getGunData(gear);

	return {
		name: escapeWikiText(gear.Name),
		pageTitle: gearPageTitle(gear),
		apiName: escapeWikiText(gear.APIName),
		gearType: gear.GearType,
		typeName: gear.TypeName ? escapeWikiText(gear.TypeName) : '',
		descriptionText: descriptionToWiki(gear.Description),
		seoDescription: stripHtml(gear.Description ?? '').slice(0, 280),
		icon: `${displayFilename(gear)}_Icon.png`,
		showcase: `${displayFilename(gear)} Showcase.png`,
		gridSize,
		skinCount: gear.SkinCount ?? 0,
		minUnlockLevel: gear.MinUnlockLevel ?? 0,
		maxLevel: gear.MaxLevel ?? 0,
		hasGunData: gd !== null,
		statsSection: buildStatsTable(gear),
		unlocksSection: buildLevelUnlocksTable(gear.LevelUnlocks, { includeChance: false }),
		upgradesSection: buildUpgradesTable(compatibleUpgrades),
		skinsSection: buildSkinsTable(compatibleSkins, gear.APIName),
		// Lowercased single-token category for [[Category:Primary]] etc.
		categoryName:
			gear.GearType === 'Throwable'
				? 'Throwables'
				: gear.GearType === 'Heavy'
					? 'Heavy Weapons'
					: gear.GearType === 'Primary'
						? 'Primary Weapons'
						: gear.GearType === 'Vehicle'
							? 'Vehicles'
							: gear.GearType === 'Utility'
								? 'Utility'
								: gear.GearType === 'Custom'
									? 'Equipment'
									: gear.GearType,
		// Forward applicable upgrades to consumers that want to populate
		// downstream cross-references in templates.
		applicableUpgradesNames: compatibleUpgrades.map((u) => stripHtml(u.Name)),
		applicableSkinsNames: compatibleSkins.map((u) => stripHtml(u.Name)),
		// Strip mapping for the "applies to" / cross-references list (parity
		// with upgrade pipeline's mapGunName).
		applicableTo: mapGunName(gear.Name)
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Classifier config (for the host-page uploader)
// ─────────────────────────────────────────────────────────────────────────

export const GEAR_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''Add gear lore here.''`, `''To be written.''`],
	cannedAcquisitionPhrases: new Set<string>(),
	curatorOnlySections: new Set(
		['lore', 'trivia', 'notes', 'bugs', 'strategy', 'tips', 'patch history', 'changelog'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set([
		'stats',
		'statistics',
		'level unlocks',
		'unlocks',
		'upgrades',
		'skin upgrades',
		'skins'
	]),
	infoboxStripPattern: /\{\{Infobox gear[\s\S]*?\}\}/g,
	// The gear skeleton drops a `[[File:<Name> Showcase.png|thumb|...]]`
	// inside Lore plus a float-clearing <div> after it. Without stripping,
	// the classifier would flag the bot's own previously-pushed page as
	// "pattern-a-edited" on the next run.
	botEmittedPatterns: [
		/\[\[File:[^\]]*Showcase[^\]]*\]\]/gi,
		/<div\s+style\s*=\s*"clear:\s*both[^"]*"\s*>\s*<\/div>/gi,
		// Legacy: pre-fix skeleton emitted `{{clear}}` (a redlink template);
		// keep stripping until every host page has been re-pushed.
		/\{\{[Cc]lear\}\}/g
	]
};

// Re-export the bundle of dump helpers used by the generator wrapper.
export function loadGearGenerationData() {
	return {
		gears: loadGears(),
		upgradesByGear: loadUpgradesByGear(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}
