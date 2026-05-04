import type { Crafting } from './data/schema.d';
import { readDump } from './dump';

// Crafting is a singleton in the dump. We wrap it in a one-element array so it
// plugs into the per-entity generator/uploader pipeline without special-casing.
export interface CraftingSingleton extends Crafting {
	id: 'crafting';
}

export function loadCrafting(): CraftingSingleton[] {
	const data = readDump() as unknown as { crafting?: Crafting };
	if (!data?.crafting || typeof data.crafting !== 'object') {
		throw new Error(`Invalid data.json shape: expected a 'crafting' singleton object`);
	}
	return [{ ...data.crafting, id: 'crafting' }];
}

export function safeFilename(): string {
	return 'crafting';
}

export function displayFilename(): string {
	return 'Crafting';
}

export function craftingPageTitle(): string {
	return 'Crafting';
}
