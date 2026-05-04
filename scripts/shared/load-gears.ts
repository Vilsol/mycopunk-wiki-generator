import type { Gear } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

export function loadGears(): Gear[] {
	const data = readDump() as unknown as { gears?: Record<string, Gear> };
	if (!data?.gears || typeof data.gears !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'gears' property`);
	}
	return Object.values(data.gears);
}

export function safeFilename(gear: Gear): string {
	if (!gear.APIName || !/[a-zA-Z0-9]/.test(gear.APIName)) {
		return `gear_${gear.ID}`;
	}
	return sanitizeAPIName(gear.APIName);
}

// Display-name-based filename used for wiki-uploaded assets (icons).
// Mirrors the upgrade `displayFilename` convention so the wiki saves the
// asset under a title the user can predict from the gear's Name.
export function displayFilename(gear: Gear): string {
	if (!gear.Name || !/[a-zA-Z0-9]/.test(gear.Name)) {
		return `gear_${gear.ID}`;
	}
	return normalizeWikiTitle(sanitizeAPIName(gear.Name));
}

export function gearPageTitle(gear: Gear): string {
	// Use the in-game display name verbatim. Curators may add redirects from
	// alternative spellings (e.g. "Blitzeg" → "Blitseg") manually.
	return gear.Name;
}
