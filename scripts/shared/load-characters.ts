import type { CharacterEntry } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

export function loadCharacters(): CharacterEntry[] {
	const data = readDump() as unknown as {
		characters?: Record<string, CharacterEntry>;
	};
	if (!data?.characters || typeof data.characters !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'characters' property`);
	}
	return Object.values(data.characters).sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0));
}

export function safeFilename(c: CharacterEntry): string {
	return sanitizeAPIName(c.APIName ?? c.Name ?? '');
}

export function displayFilename(c: CharacterEntry): string {
	if (!c.Name || !/[a-zA-Z0-9]/.test(c.Name)) return sanitizeAPIName(c.APIName ?? '');
	return normalizeWikiTitle(sanitizeAPIName(c.Name));
}

export function characterPageTitle(c: CharacterEntry): string {
	return c.Name;
}
