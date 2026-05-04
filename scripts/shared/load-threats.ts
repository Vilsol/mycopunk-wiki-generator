import type { Threat } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

export function loadThreats(): Threat[] {
	const data = readDump() as unknown as { threats?: Record<string, Threat> };
	if (!data?.threats || typeof data.threats !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'threats' property`);
	}
	return Object.values(data.threats);
}

export function safeFilename(threat: Threat): string {
	return sanitizeAPIName(threat.ID);
}

export function displayFilename(threat: Threat): string {
	const name = threat.Name || threat.ID;
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function threatPageTitle(threat: Threat): string {
	return threat.Name || threat.NumberLabel || threat.ID;
}
