import { colord } from 'colord';
import {
	ActionFireMode,
	LabelType,
	OverrideType,
	type OverrideData,
	type Property,
	type Range,
	type Stat
} from './types';

// Resolve a property's stats for a given upgradable. With no upgradable,
// returns the first available context (matching the legacy "first wins"
// behavior of the old `Stats` field).
export const getPropertyStats = (property: Property, upgradableAPIName?: string): Stat[] => {
	const byUpgradable = property.StatsByUpgradable;
	if (!byUpgradable) return [];
	if (upgradableAPIName && byUpgradable[upgradableAPIName]) {
		return byUpgradable[upgradableAPIName];
	}
	return Object.values(byUpgradable)[0] ?? [];
};

// Structured stat row: name (label) + value (formatted). When a row has no
// name, render it spanning both cells (used for special-case formatter output
// like "Can fire while sprinting" that doesn't have a separate label).
export interface StatRow {
	readonly name?: string;
	readonly value: string;
}

// Resolve a property's rolled-value map for a given upgradable. Mirrors the
// "first wins" fallback used by getPropertyStats so callers get a consistent
// upgradable across the two lookups.
const getRolledValues = (
	property: Property,
	upgradableAPIName?: string
): Record<string, string[]> => {
	const byUpgradable = property.RolledValuesByUpgradable;
	if (!byUpgradable) return {};
	if (upgradableAPIName && byUpgradable[upgradableAPIName]) {
		return byUpgradable[upgradableAPIName];
	}
	return Object.values(byUpgradable)[0] ?? {};
};

// Pair the formatter's value strings with the raw stat names. Falls back to a
// nameless (colspan) row whenever a position has no usable name — e.g. for
// special-case formatter branches that emit prose, or when the lengths
// disagree because the formatter took a custom path.
//
// When `RolledValuesByUpgradable` records the property's stat as
// non-deterministic and the stat is *categorical* (no minValue/maxValue —
// e.g. Element=Fire/Shock/Acid, Adds=Row/Column), the row's value gets
// replaced by all observed rolls joined with " / ". For numeric ranges the
// formatter's existing [min - max] output is preserved since the rolled set
// is just a sampled distribution within those bounds.
export const getPropertyStatRows = (property: Property, upgradableAPIName?: string): StatRow[] => {
	const valid = getPropertyStats(property, upgradableAPIName).filter((s) => s.IsValid !== false);
	const formatted = getStatsFromProperty(property, true, upgradableAPIName);
	if (!formatted) return [];
	const rolled = getRolledValues(property, upgradableAPIName);
	return formatted.map((value, i) => {
		const stat = valid[i];
		const rawName = stat?.name?.trim();
		if (!rawName) return { value };

		// "Element" is overloaded in the game's stat labels: sometimes it's a
		// categorical type (Fire/Shock/Acid roll, value contains color tags),
		// sometimes it's a numeric amount/intensity (e.g. "Bullets apply more
		// of their elemental effect" → +12% range). Disambiguate the numeric
		// case so the wiki reader can tell the two semantics apart.
		const name =
			rawName === 'Element' && (stat?.minValue || stat?.maxValue) ? 'Element Amount' : rawName;

		// Show all rolled values only when the stat is genuinely categorical:
		// no min/max range *and* a small distinct set. The ≤5 cap filters out
		// numeric-distribution stats sampled across 16 seeds (which would
		// produce ≥6-value lists redundant with the formatter's range output)
		// and mixed-mode stats where one of the 16 samples returned a number
		// alongside element strings — those are better served by the
		// formatter's seed=0 sample than a long mixed list.
		const rolls = rolled[stat.name];
		const isCategorical = !stat.minValue && !stat.maxValue;
		if (rolls && rolls.length > 1 && rolls.length <= 5 && isCategorical) {
			return { name, value: rolls.join(' / ') };
		}
		return { name, value };
	});
};

export interface RGBColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

const colorRegex = /RGBA\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/;

export function parseRGBA(rgbaString: string): RGBColor | null {
	const match = rgbaString.match(colorRegex);
	if (!match) return null;
	return {
		r: Math.round(parseFloat(match[1]) * 255),
		g: Math.round(parseFloat(match[2]) * 255),
		b: Math.round(parseFloat(match[3]) * 255),
		a: parseFloat(match[4])
	};
}

export function convertColor(c: string): string {
	const rgb = parseRGBA(c);
	if (!rgb) return c;
	return colord(rgb).toRgbString();
}

const codeRegex = /<([^>]+)>/g;

const namedColors = new Set([
	'red',
	'green',
	'blue',
	'white',
	'black',
	'yellow',
	'orange',
	'purple',
	'cyan',
	'magenta',
	'gray',
	'grey'
]);

const colorValueRegex = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|[a-zA-Z]+)$/;

const escapeHtml = (s: string) =>
	s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const isValidCssColor = (value: string): boolean => {
	if (!colorValueRegex.test(value)) return false;
	if (value.startsWith('#') || value.startsWith('rgb')) return true;
	return namedColors.has(value.toLowerCase());
};

export const convertCode = (text: string) => {
	return text.replaceAll(codeRegex, (_: string, value: string) => {
		if (value.startsWith('color=')) {
			const colorValue = value.substring(6);
			if (!isValidCssColor(colorValue)) return '';
			return `<span style="color: ${escapeHtml(colorValue)}">`;
		} else if (value === '/color') {
			return `</span>`;
		}

		return '';
	});
};

// Wiki-specific superset of `convertCode`: also converts `<link=X>...</link>`
// rich-text tags to MediaWiki piped wikilinks `[[X|...]]`. The web app keeps
// using `convertCode` (HTML output); the wiki generator uses this so links
// like `<link=core><color=#FFE4B4>cores</color></link>` round-trip into
// `[[core|<span style="color: #FFE4B4">cores</span>]]` instead of dropping
// the link target.
export const convertCodeWiki = (text: string): string => {
	const linked = text
		.replace(/<link=([^>]+)>/g, (_, target) => `[[${target}|`)
		.replace(/<\/link>/g, ']]');
	return convertCode(linked);
};

const formatChanceProperty = (name: string, chance?: number | Range<number>): string[] => {
	let chanceValue = 0;
	if (typeof chance === 'number') {
		chanceValue = chance;
	} else if (chance && 'min' in chance) {
		chanceValue = chance.min;
	}
	return [`${name} Chance: ${(chanceValue * 100).toFixed(2)}%`];
};

export const roundToDigits = (value: number, digits: number) => {
	return Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits);
};

const createFormatter = (digits: number, signed: boolean) =>
	new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits,
		signDisplay: signed ? 'exceptZero' : 'auto'
	});

export const getValueStringFromOverrideData = (
	overrideData: OverrideData<number>,
	digits: number
) => {
	return getValueString(overrideData.method, overrideData.data, digits);
};

export const getValueStringFromOverrideDataRange = (
	overrideData: OverrideData<Range<number>>,
	digits: number
) => {
	if (!overrideData.data || overrideData.method === OverrideType.None) {
		return null;
	}

	if (overrideData.data.min === overrideData.data.max) {
		return getValueString(overrideData.method, overrideData.data.min, digits);
	}

	return `[${getValueString(overrideData.method, overrideData.data.min, digits)} - ${getValueString(overrideData.method, overrideData.data.max, digits)}]`;
};

export const getValueString = (overrideType: OverrideType, value: number, digits: number) => {
	switch (overrideType) {
		case OverrideType.Add: {
			const num = roundToDigits(value, digits);
			return createFormatter(Number.isInteger(num) ? 0 : digits, true).format(num);
		}
		case OverrideType.Multiply: {
			const percentValue = value >= 1 || value < 0 ? (value - 1) * 100 : -(1 - value) * 100;
			const num = roundToDigits(percentValue, 1);
			return `${createFormatter(Number.isInteger(num) ? 0 : 1, true).format(num)}%`;
		}
		case OverrideType.Override: {
			const num = roundToDigits(value, digits);
			return createFormatter(Number.isInteger(num) ? 0 : digits, false).format(num);
		}
		default:
			return null;
	}
};

// Formats stats with ranges
//
// Example:
//
// Min does not match max:
// (-55% - +100%) Fire rate
// (+11.5 - +56.3) Damage
//
// Min matches max:
// 0 Laser charge on hit
// +1 Ammo cost
export const getStatsFromProperty = (
	property: Property,
	noLabel = false,
	upgradableAPIName?: string
): string[] | null => {
	// Handle special cases
	switch (property.Type) {
		case 'UpgradeProperty_UpgradeFlag': // Completely custom flags for each upgrade
		case 'UpgradeProperty_PlayerUpgradeFlag': // Completely custom flags for each upgrade
		case 'UpgradeProperty_FireSound': // Cosmetic
		case 'SkinUpgradeProperty_GunCrab': // Unknown
		case 'SkinUpgradeProperty_GunCrab_List': // Cosmetic
		case 'UpgradeProperty_ShieldProjector_ShieldPrefab': // Prefab
		case 'UpgradeProperty_BulletPrefab': // Prefab
		case 'UpgradeProperty_SpawnObject': // Prefab
		case 'UpgradeProperty_MuzzleFlash': // Cosmetic
		case 'UpgradeProperty_ReloadAnimation': // Cosmetic
		case 'SkinUpgradeProperty_Texture': // Cosmetic
		case 'UpgradeProperty_ChargeOther': // Wrong?
		case 'SkinUpgradeProperty_OverlayMat': // Cosmetic
		case 'SkinUpgradeProperty_Color': // Cosmetic
			return null;
		case 'UpgradeProperty_Aim': // Has no stats by default
			return [`${property.Raw.aimFOV?.data} Aim FOV`];
		case 'UpgradeProperty_BulletShake':
			return [
				`[${property.Raw.bulletShakeTranslation?.data.min} - ${property.Raw.bulletShakeTranslation?.data.max}] Shake Translation`,
				`[${property.Raw.bulletShakeRotation?.data.min} - ${property.Raw.bulletShakeRotation?.data.max}] Shake Rotation`
			];
		case 'UpgradeProperty_AutomaticFire':
			return [property.Raw.automatic?.data === 0 ? `Manual Firing` : `Automatic Firing`];
		case 'UpgradeProperty_Glider_Look':
			return [
				`Lock fly direction: ${property.Raw.lockFlyDirection?.data}`,
				`Fly look sensitivity: ${property.Raw.flyLookSensitivityMultiplier?.data}`
			];
		case 'UpgradeProperty_ShieldProjector_Size':
			return [
				`[${property.Raw.sizeX?.data.min} - ${property.Raw.sizeX?.data.max}] Size X`,
				`[${property.Raw.sizeY?.data.min} - ${property.Raw.sizeY?.data.max}] Size Y`,
				`Raise from ground: ${property.Raw.raiseFromGround?.data}`
			];
		case 'UpgradeProperty_ShieldProjector_PushForce':
			if (getValueStringFromOverrideDataRange(property.Raw.pushForce!, 2)) {
				return [`${getValueStringFromOverrideDataRange(property.Raw.pushForce!, 2)} Push Force`];
			}
			return null;
		case 'UpgradeProperty_FireConstraints':
			// eslint-disable-next-line no-case-declarations
			const result: string[] = [];
			if (property.Raw.canFireWhileSprinting?.data === ActionFireMode.CanPerformDuring) {
				result.push(`Can fire while sprinting`);
			}
			if (property.Raw.canFireWhileJumping?.data) {
				result.push(`Can fire while jumping`);
			}
			if (property.Raw.canFireWhileSliding?.data === ActionFireMode.CanPerformDuring) {
				result.push(`Can fire while sliding`);
			}
			if (property.Raw.canAimWhileSliding?.data === ActionFireMode.CanPerformDuring) {
				result.push(`Can aim while sliding`);
			}
			return result;
		case 'SkinUpgradeProperty_Preset':
			return [
				`Preset (${property.Raw.preset!.instanceID}) ${formatChanceProperty('', property.Raw.chance)[0]}`
			];
		case 'SkinUpgradeProperty_Infection':
			return formatChanceProperty('Infection', property.Raw.chance);
		case 'SkinUpgradeProperty_ColorTossing':
			return formatChanceProperty('Color Tossing', property.Raw.chance);
		case 'SkinUpgradeProperty_Coppertone':
			return formatChanceProperty('Coppertone', property.Raw.chance);
		case 'SkinUpgradeProperty_Bloodmetal':
			return formatChanceProperty('Bloodmetal', property.Raw.chance);
		case 'SkinUpgradeProperty_Chroma':
			return formatChanceProperty('Chroma', property.Raw.chance);
		case 'SkinUpgradeProperty_Trim':
			return formatChanceProperty('Trim', property.Raw.chance);
		case 'SkinUpgradeProperty_Overlay':
			return formatChanceProperty('Overlay', property.Raw.chance);
		case 'SkinUpgradeProperty_Negative':
			return formatChanceProperty('Negative', property.Raw.chance);
		case 'SkinUpgradeProperty_Pixelated':
			return formatChanceProperty('Pixelated', property.Raw.chance);
		case 'SkinUpgradeProperty_PoolParty':
			return formatChanceProperty('Pool Party', property.Raw.chance);
		case 'SkinUpgradeProperty_ColorCycling':
			return formatChanceProperty('Color Cycling', property.Raw.chance);
		case 'SkinUpgradeProperty_Neon':
			return formatChanceProperty('Neon', property.Raw.chance);
		case 'SkinUpgradeProperty_Hue':
			return formatChanceProperty('Hue', property.Raw.chance);
		case 'SkinUpgradeProperty_NegativeRange':
			return formatChanceProperty('Negative Range', property.Raw.chance);
		// TODO Inverse calculations
		// UpgradeProperty_BounceShotgun_BulletCharge
		// UpgradeProperty_BounceShotgun_FastIgniteReload
		// UpgradeProperty_BounceShotgun_IgniteFireInterval
		// UpgradeProperty_Bruiser_NoseDiveCooldown
		// UpgradeProperty_FireInterval
		// UpgradeProperty_MiniCannonFiring
		// UpgradeProperty_Player_AbilityCooldown
		// UpgradeProperty_Reload
		// UpgradeProperty_Salvo_Cooldown
		// UpgradeProperty_Salvo_FlyFuelUseSpeed
		// UpgradeProperty_Salvo_SalvoLocks
		// UpgradeProperty_Scrapper_JetpackRecharge
		// UpgradeProperty_SMG_ChargeBurst
		// UpgradeProperty_SMG_FastReloadOnKill
		// UpgradeProperty_SwarmGun_AirSpawn
		// UpgradeProperty_SwarmGun_AutoRegen
		// UpgradeProperty_SwarmGun_ShockReload
		// UpgradeProperty_ThrowableCooldown
		// UpgradeProperty_Trident_AimFireInterval
		// UpgradeProperty_Trident_IgnitionFireRate
		// UpgradeProperty_Trident_Spinner
	}

	const stats: string[] = [];

	const propertyStats = getPropertyStats(property, upgradableAPIName);
	if (propertyStats.length === 0) {
		return stats;
	}

	for (const stat of propertyStats) {
		if (stat.IsValid === false) {
			continue;
		}

		let value = stat.value;
		if (stat.minValue && stat.maxValue) {
			if (
				stat.minValue.startsWith('+') ||
				stat.minValue.startsWith('-') ||
				stat.minValue.endsWith('%')
			) {
				if (stat.minValue !== stat.maxValue) {
					value = `[${stat.minValue} - ${stat.maxValue}]`;
				}
			} else {
				const min = parseFloat(stat.minValue);
				const max = parseFloat(stat.maxValue);

				const minValue = getValueString(stat.overrideType, min, 2);
				const maxValue = getValueString(stat.overrideType, max, 2);

				if (minValue !== maxValue) {
					value = `[${minValue} - ${maxValue}]`;
				}
			}
		}

		if (noLabel) {
			stats.push(value);
			continue;
		}

		const statName = convertCode(stat.name);
		switch (stat.labelType) {
			case LabelType.Before:
				stats.push(`${statName} ${value}`);
				break;
			case LabelType.BeforeWithColon:
				stats.push(`${statName}: ${value}`);
				break;
			case LabelType.After:
				stats.push(`${value} ${statName}`);
				break;
		}
	}

	return stats;
};

export const gunMappings: Record<string, string> = {
	'The Carver': 'The Carver',
	Globbler: 'Globbler',
	'Plate Launcher': 'FR.15833 Plate Launcher',
	'Swarm Gun': 'Swarm Launcher',
	'Bounce Shotgun': 'AU-SI Jackrabbit',
	SMG: 'The Cycler',
	Scout: 'DMLR',
	'Mini Cannon': 'Gunship Cannon',
	'Fast Shotgun': 'Lead Flinger',
	'Wide Gun': 'Trident S2',
	'Global Resources': 'Everything',
	Scrapper: 'Scrapper',
	Wrangler: 'Wrangler',
	Bruiser: 'Bruiser',
	Glider: 'Glider',
	'Acid Grenade': 'Acid Grenade',
	'Voltaic Grenade': 'Shock Grenade',
	'Incendiary Grenade': 'Incendiary Grenade'
};
