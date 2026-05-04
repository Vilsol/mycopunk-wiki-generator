import type { RarityEntry } from './data/schema.d';
import { readDump } from './dump';

export function loadRarities(): RarityEntry[] {
	const data = readDump() as unknown as { rarities?: Record<string, RarityEntry> };
	if (!data?.rarities || typeof data.rarities !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'rarities' property`);
	}
	// Stable order: power tier (Standard < Rare < Epic < Exotic < Oddity < Contraband).
	const ORDER = ['standard', 'rare', 'epic', 'exotic', 'oddity', 'contraband'];
	return Object.values(data.rarities).sort((a, b) => {
		const ai = ORDER.indexOf(a.Name);
		const bi = ORDER.indexOf(b.Name);
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
	});
}

// Title-Case the dump's lowercased rarity names: "exotic" → "Exotic".
export function rarityDisplay(r: RarityEntry): string {
	if (!r.Name) return '';
	return r.Name[0].toUpperCase() + r.Name.slice(1);
}

export function safeFilename(r: RarityEntry): string {
	return r.Name;
}

export function displayFilename(r: RarityEntry): string {
	return `${rarityDisplay(r)}_Rarity`;
}

// Page titles get a " Rarity" suffix to avoid collision with adjective uses
// (e.g. `Rare` could plausibly mean a category page).
export function rarityPageTitle(r: RarityEntry): string {
	return `${rarityDisplay(r)} Rarity`;
}
