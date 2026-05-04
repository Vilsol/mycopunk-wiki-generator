import type { Collectable } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

export function loadCollectables(): Collectable[] {
	const data = readDump() as unknown as { collectables?: Record<string, Collectable> };
	if (!data?.collectables || typeof data.collectables !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'collectables' property`);
	}
	return Object.values(data.collectables);
}

export function safeFilename(c: Collectable): string {
	return sanitizeAPIName(c.ID);
}

export function displayFilename(c: Collectable): string {
	const name = c.Name || c.ID;
	if (!/[a-zA-Z0-9]/.test(name)) return sanitizeAPIName(c.ID);
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function collectablePageTitle(c: Collectable): string {
	return c.Name || c.ID;
}
