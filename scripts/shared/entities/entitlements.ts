// DLC / supporter pack pages: one page per entitlement, listing the skins the
// pack unlocks. Pack display names aren't in localization, so they're mapped here.

import type { Entitlement } from '../data/schema.d';
import { readDump } from '../dump';
import { defineEntity } from '../entity-registry';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName } from '../wiki-text';
import { loadSkins, skinDisplayName, skinPageTitle } from './skins';
import { rarityCell } from '../rarity-display';

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

const PACK_NAMES: Record<string, string> = {
	SupporterPack: 'Supporter Pack',
	PlusEntitlementPack: 'PlayStation Plus Pack'
};

export function entitlementDisplayName(key: string): string {
	return PACK_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function loadEntitlements(): Entitlement[] {
	const data = readDump() as unknown as { entitlements?: Record<string, Entitlement> };
	if (!data?.entitlements || typeof data.entitlements !== 'object') {
		throw new Error(`Invalid data.json shape: expected an 'entitlements' object`);
	}
	return Object.entries(data.entitlements).map(([key, e]) => ({ ...e, Name: e.Name ?? key }));
}

export function safeFilename(e: Entitlement): string {
	return sanitizeAPIName(e.Name);
}

export function displayFilename(e: Entitlement): string {
	return normalizeWikiTitle(sanitizeAPIName(entitlementDisplayName(e.Name)));
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

function platforms(e: Entitlement): string {
	const out: string[] = [];
	if (e.AvailableOnSteam) out.push('Steam');
	if (e.PS5ID) out.push('PlayStation 5');
	return out.join(', ');
}

const packSkins = (e: Entitlement) =>
	loadSkins().filter((s) => s.skin.RequiredEntitlement === e.Name);

function buildSkinsTable(e: Entitlement): string {
	const skins = packSkins(e);
	if (skins.length === 0) return '';
	const out = ['{| class="wikitable sortable"', '! Skin !! Type !! Rarity !! Applies to'];
	for (const s of skins) {
		const parents = s.parentDisplays.map((p) => `[[${p}]]`).join(', ') || '—';
		out.push('|-');
		out.push(
			`| [[${skinPageTitle(s)}|${escapeWikiText(skinDisplayName(s))}]] || ${s.skin.SkinTypeName ?? '—'} || ${rarityCell(s.upgrade.Rarity)} || ${parents}`
		);
	}
	out.push('|}');
	return out.join('\n');
}

export function buildEntitlementContext(e: Entitlement): Record<string, unknown> {
	const name = entitlementDisplayName(e.Name);
	return {
		name,
		platforms: platforms(e),
		steamId: e.SteamID || '',
		skinCount: packSkins(e).length,
		seoDescription: `${name} DLC in Mycopunk and the cosmetics it unlocks.`,
		skinsSection: buildSkinsTable(e)
	};
}

export function loadEntitlementGenerationData() {
	return {
		entitlements: loadEntitlements(),
		gameVersion: (readDump().gameVersion?.Version ?? 'unknown') as string
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<Entitlement>({
	name: 'entitlements',
	dumpKey: 'entitlements',
	loadItems: loadEntitlements,
	safeFilename,
	displayFilename,
	pageTitle: (e) => entitlementDisplayName(e.Name),
	identLabel: (e) => e.Name,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['skins', 'overview'],
		infoboxTemplateName: 'Infobox dlc pack'
	},
	templateName: 'entitlement-source.wiki',
	skeletonTemplateName: 'entitlement-skeleton.wiki',
	contextBuilder: buildEntitlementContext
	// no fileTypes — the nametag icon isn't extracted
});
