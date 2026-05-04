import type { StatusEffect } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';
import { isColliding, STATUS_EFFECT_SUFFIX } from './cross-entity-collisions';

export function loadStatusEffects(): StatusEffect[] {
	const data = readDump() as unknown as { statusEffects?: Record<string, StatusEffect> };
	if (!data?.statusEffects || typeof data.statusEffects !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'statusEffects' property`);
	}
	// Skip `el_normal` — placeholder "no element", not a real status. Other
	// entries (immune, yeuco) are kept; Tuning section is gated downstream.
	return Object.values(data.statusEffects).filter((e) => e.ID !== 'el_normal');
}

export function safeFilename(effect: StatusEffect): string {
	return sanitizeAPIName(effect.ID);
}

export function displayFilename(effect: StatusEffect): string {
	if (!effect.Name || !/[a-zA-Z0-9]/.test(effect.Name)) return sanitizeAPIName(effect.ID);
	const base = normalizeWikiTitle(sanitizeAPIName(effect.Name));
	return isColliding(effect.Name) ? `${base}${STATUS_EFFECT_SUFFIX.filenameSuffix}` : base;
}

export function statusEffectPageTitle(effect: StatusEffect): string {
	const name = effect.Name ?? effect.ID;
	return isColliding(name) ? `${name}${STATUS_EFFECT_SUFFIX.titleSuffix}` : name;
}
