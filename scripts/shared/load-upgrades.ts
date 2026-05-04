import type { GenericGunUpgrade } from './upgrades/types';
import { gunMappings } from './upgrades/utils';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

export function safeFilename(upgrade: GenericGunUpgrade): string {
	if (!upgrade.APIName || !/[a-zA-Z0-9]/.test(upgrade.APIName)) {
		return `upgrade_${upgrade.ID}`;
	}
	return sanitizeAPIName(upgrade.APIName);
}

// Display-name-based filename, used for upgrade-facing assets (icons, patterns)
// uploaded to the wiki. Falls back to `upgrade_<ID>` when the display name has
// no usable characters.
export function displayFilename(upgrade: GenericGunUpgrade): string {
	if (!upgrade.Name || !/[a-zA-Z0-9]/.test(upgrade.Name)) {
		return `upgrade_${upgrade.ID}`;
	}
	return normalizeWikiTitle(sanitizeAPIName(upgrade.Name));
}

// `ApplicableTo[].Name` is "<DisplayName> (<C# class>)". Strip the parens
// suffix, then remap a few legacy display names that the wiki shows under a
// different title (see `gunMappings`).
export function mapGunName(rawName: string): string {
	const stripped = rawName.split(' (')[0];
	return gunMappings[stripped] ?? stripped;
}

export function loadUpgrades(): GenericGunUpgrade[] {
	const data = readDump();
	if (!data?.upgrades || typeof data.upgrades !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with an 'upgrades' property`);
	}
	return Object.values(data.upgrades) as GenericGunUpgrade[];
}
