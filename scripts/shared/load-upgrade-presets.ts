// Upgrade-preset entity: 1.8.2's `upgradePresets` catalog is the source of
// truth for named property bundles (Coppertone, Bloodmetal, Topaz…) referenced
// by `SkinUpgradeProperty_Preset.preset`. One page per preset.

import type { UpgradePresetEntry } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

export function loadUpgradePresets(): UpgradePresetEntry[] {
	const data = readDump() as unknown as {
		upgradePresets?: Record<string, UpgradePresetEntry>;
	};
	if (!data?.upgradePresets || typeof data.upgradePresets !== 'object') {
		throw new Error(`Invalid data.json shape: expected an 'upgradePresets' object`);
	}
	return Object.values(data.upgradePresets).sort((a, b) =>
		(a.Name ?? '').localeCompare(b.Name ?? '')
	);
}

export function safeFilename(p: UpgradePresetEntry): string {
	return sanitizeAPIName(p.Name ?? '');
}

export function displayFilename(p: UpgradePresetEntry): string {
	return normalizeWikiTitle(sanitizeAPIName(`${p.Name}_Preset`));
}

// Match wiki convention used for directives ("<name> Mission Modifier"): a
// human-readable suffix avoids collisions with bare adjectives like "Topaz"
// that may have other uses.
export function presetPageTitle(p: UpgradePresetEntry): string {
	return `${p.Name} Skin Preset`;
}
