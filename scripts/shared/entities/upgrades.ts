// Upgrade entity: formatter context, enrichment lookups, changelog assembly,
// related-pages template, and upload classifier config. The generation script
// (`scripts/generate-upgrade-source.ts`) and the generic uploaders consume
// this module so all upgrade-specific knowledge lives in one place.

import fs from 'node:fs';
import { getPropertyStatRows, convertCode, convertCodeWiki } from '../upgrades/utils';
import type { GenericGunUpgrade, DataDump } from '../upgrades/types';
import type { AuthItem, SkillTreeNode } from '../data/schema.d';
import type { ChangeRecord, IndexEntry } from '../dump-types';
import { fetchManifest, fetchVersionDump, dumpCachePath } from '../dump-cache';
import { cachedDiff } from '../dump-diff-cache';
import { renderChangelogSection } from '../changelog-renderer';
import { readDump } from '../dump';
import { escapeWikiText, stripHtml } from '../wiki-text';
import { loadUpgrades, safeFilename, displayFilename, mapGunName } from '../load-upgrades';
import type { EntityClassifierConfig } from '../upload-pipeline';

type SkillTreeNodeWithChar = SkillTreeNode & { character: string };

export interface UpgradeEnrichment {
	authItemsByUpgradeID: Map<string, AuthItem>;
	skillTreeByUpgradeID: Map<string, SkillTreeNodeWithChar>;
	upgradeNamesByID: Map<string, string>;
}

// Build per-upgrade lookups from the dump for the cross-reference fields:
//   - authItems redemption-code items
//   - skill-tree node placement (every UpgradeTree-source upgrade is in
//     exactly one character's skill tree)
//   - upgrade ID → display name (resolves SkillTreeNode.MustBeUnlockedFirst)
export function loadUpgradeEnrichment(): UpgradeEnrichment {
	const data = readDump();

	const authItemsByUpgradeID = new Map<string, AuthItem>();
	for (const item of Object.values(data.authItems ?? {}) as AuthItem[]) {
		if (item.Upgrade) authItemsByUpgradeID.set(String(item.Upgrade), item);
	}

	const skillTreeByUpgradeID = new Map<string, SkillTreeNodeWithChar>();
	for (const [character, char] of Object.entries(data.characters ?? {}) as [
		string,
		{ SkillTree?: SkillTreeNode[] }
	][]) {
		for (const node of char.SkillTree ?? []) {
			skillTreeByUpgradeID.set(String(node.Upgrade), { ...node, character });
		}
	}

	const upgradeNamesByID = new Map<string, string>();
	for (const u of Object.values(data.upgrades ?? {}) as { ID: string; Name: string }[]) {
		upgradeNamesByID.set(String(u.ID), stripHtml(u.Name ?? ''));
	}

	return { authItemsByUpgradeID, skillTreeByUpgradeID, upgradeNamesByID };
}

const COLLECTION_SOURCE_PHRASES: Record<string, string> = {
	WorldPool: 'Found in the world drop pool.',
	UpgradeTree: "Earned through the gear's upgrade tree.",
	DropsFromSource: 'Awarded as a special drop.',
	HiddenIfNotOwned: 'Hidden in the upgrade browser until obtained.',
	HiddenAlways: 'Hidden from the upgrade browser.'
};

function formatCostLine(costs: GenericGunUpgrade['UnlockCost'] | undefined): string {
	if (!costs || costs.length === 0) return '';
	return costs
		.map((c) => `${c.Count} [[${escapeWikiText(c.Resource ?? c.ResourceID ?? 'Unknown')}]]`)
		.join(', ');
}

function buildAcquisitionSection(
	upgrade: GenericGunUpgrade,
	enrichment: UpgradeEnrichment
): string {
	const lines: string[] = [];

	const auth = enrichment.authItemsByUpgradeID.get(String(upgrade.ID));
	const node = enrichment.skillTreeByUpgradeID.get(String(upgrade.ID));
	const sourcePhrase = COLLECTION_SOURCE_PHRASES[upgrade.CollectionSource ?? ''] ?? null;

	if (auth) {
		lines.push(`'''Source:''' Awarded by redeeming the [[${auth.Name}]] item.`);
	} else if (node) {
		const tier = (node.Layer ?? 0) + 1;
		const minPts = node.MinSpentSkillPointsToUnlock ?? 0;
		const cost =
			minPts === 0
				? 'starter ability'
				: `requires ${minPts} skill point${minPts === 1 ? '' : 's'} spent`;
		const prereqID = node.MustBeUnlockedFirst ? String(node.MustBeUnlockedFirst) : null;
		const prereqName = prereqID ? enrichment.upgradeNamesByID.get(prereqID) : null;
		const prereq = prereqName
			? ` Requires unlocking [[${prereqName} Upgrade|${prereqName}]] first.`
			: prereqID
				? ` Requires unlocking upgrade ${prereqID} first.`
				: '';
		lines.push(
			`'''Source:''' Unlocked from the [[${node.character}]] skill tree at Tier ${tier} (${cost}).${prereq}`
		);
	} else if (sourcePhrase) {
		lines.push(`'''Source:''' ${sourcePhrase}`);
	}

	const ouro = formatCostLine(upgrade.OuroborosCost);
	const turbo = formatCostLine(upgrade.TurbochargeCost);
	if (ouro || turbo) {
		lines.push('');
		lines.push("'''Costs:'''");
		if (ouro) lines.push(`* Ouroboros redemption: ${ouro}`);
		if (turbo) lines.push(`* Turbocharge: ${turbo}`);
	}

	return lines.join('\n');
}

export function upgradePageTitle(upgrade: GenericGunUpgrade): string {
	return `${stripHtml(upgrade.Name)} Upgrade`;
}

function generatePropertiesSection(upgrade: GenericGunUpgrade): string {
	if (!upgrade.Properties || upgrade.Properties.length === 0) return '';

	const visibleProperties = upgrade.Properties.filter((p) => p.StatNames && p.StatNames.length > 0);
	if (visibleProperties.length === 0) return '';

	const allRows = visibleProperties.flatMap((p) => getPropertyStatRows(p));
	if (allRows.length === 0) return '';

	const out: string[] = ['{| class="wikitable sortable"', '! Stat !! Value'];
	for (const row of allRows) {
		out.push('|-');
		if (row.name) {
			out.push(`| ${convertCode(row.name)} || ${convertCode(row.value)}`);
		} else {
			out.push(`| colspan="2" | ${convertCode(row.value)}`);
		}
	}
	out.push('|}');
	return out.join('\n');
}

// Plain-text description for `og:description`. Discord/Twitter crawlers want
// unstyled text — strip the wiki/HTML markup, collapse whitespace, cap length,
// and escape characters that would terminate the {{#seo: ... }} parser.
function plainDescription(raw: string | undefined | null): string {
	if (!raw) return '';
	const text = convertCode(raw)
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const capped = text.length > 280 ? text.slice(0, 277) + '...' : text;
	return capped
		.replaceAll('|', '{{!}}')
		.replaceAll('{{', '&#123;&#123;')
		.replaceAll('}}', '&#125;&#125;');
}

function humanizeUpgradeType(t: string): string | null {
	if (t === 'Normal') return null;
	if (t === 'OnlyOneOfThisType') return 'Unique (one per loadout)';
	return t;
}

export function buildUpgradeContext(
	upgrade: GenericGunUpgrade,
	enrichment: UpgradeEnrichment,
	changelog: string
): Record<string, unknown> {
	return {
		acquisition: buildAcquisitionSection(upgrade, enrichment),
		changelog,
		name: escapeWikiText(upgrade.Name),
		pageTitle: upgradePageTitle(upgrade),
		icon: `${escapeWikiText(displayFilename(upgrade))}_Icon.png`,
		rarity: upgrade.Rarity,
		effectType: upgrade.EffectType === 'Normal' ? null : upgrade.EffectType,
		upgradeType: humanizeUpgradeType(upgrade.UpgradeType),
		effectTypeRaw: upgrade.EffectType,
		upgradeTypeRaw: upgrade.UpgradeType,
		pattern: `${escapeWikiText(displayFilename(upgrade))}_Pattern.svg`,
		unlockCosts: upgrade.UnlockCost || [],
		apiName: escapeWikiText(upgrade.APIName),
		flags: upgrade.Flags ? escapeWikiText(upgrade.Flags) : null,
		applicableTo: upgrade.ApplicableTo?.length
			? `[[${upgrade.ApplicableTo.map((a) => mapGunName(a.Name)).join(']], [[')}]]`
			: null,
		descriptionText: upgrade.Description ? convertCodeWiki(upgrade.Description) : '',
		seoDescription: plainDescription(upgrade.Description),
		propertiesSection: generatePropertiesSection(upgrade),
		applicableCategories: (upgrade.ApplicableTo || []).map((a) => a.Name.split('(')[0].trim())
	};
}

// `Template:Related Pages` content — the cross-page navigation block every
// upgrade page transcludes via `{{Related Pages}}`. Built from `data.gears`
// + `data.characters` so adding a new gear in a future game patch propagates
// to every upgrade page after one bot rerun + one template upload.
export function buildRelatedPagesTemplate(): string {
	const data = readDump() as unknown as {
		gears: Record<string, { Name: string; GearType: string }>;
		characters: Record<string, { Name: string; Index?: number }>;
	};

	const gearsByType = new Map<string, string[]>();
	for (const g of Object.values(data.gears)) {
		const list = gearsByType.get(g.GearType) ?? [];
		list.push(g.Name);
		gearsByType.set(g.GearType, list);
	}
	for (const list of gearsByType.values()) list.sort();

	const characters = Object.values(data.characters)
		.sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0))
		.map((c) => c.Name);

	const link = (name: string) => `[[${name}]]`;
	const join = (items: string[]) => items.map(link).join(' • ');

	const solo = (label: string, items: string[]) =>
		`|-\n| colspan="2" | '''${label}'''\n| ${join(items)}`;
	const groupHead = (group: string, span: number, sublabel: string, items: string[]) =>
		`|-\n| rowspan="${span}" | '''${group}'''\n| ${sublabel}\n| ${join(items)}`;
	const groupTail = (sublabel: string, items: string[]) => `|-\n| ${sublabel}\n| ${join(items)}`;

	const sections: string[] = [];
	sections.push(solo('Characters', ['Upgrades|Universal', ...characters]));

	const primaries = gearsByType.get('Primary') ?? [];
	const heavies = gearsByType.get('Heavy') ?? [];
	if (primaries.length && heavies.length) {
		sections.push(groupHead('Weapons', 2, 'Primary', primaries));
		sections.push(groupTail('Heavy', heavies));
	} else if (primaries.length) {
		sections.push(solo('Weapons', primaries));
	} else if (heavies.length) {
		sections.push(solo('Weapons', heavies));
	}

	const throwables = gearsByType.get('Throwable') ?? [];
	if (throwables.length) sections.push(solo('Grenades', throwables));
	const utilities = gearsByType.get('Utility') ?? [];
	if (utilities.length) sections.push(solo('Utility', utilities));
	const vehicles = gearsByType.get('Vehicle') ?? [];
	if (vehicles.length) sections.push(solo('Vehicles', vehicles));

	return [
		`<noinclude>`,
		`This template renders the standard cross-page navigation block embedded`,
		`at the bottom of every upgrade page. It is auto-generated from the game`,
		`data dump (\`data.gears\` + \`data.characters\`); edits made directly`,
		`here will be overwritten on the next bot run. To change the navigation`,
		`structure, modify \`scripts/shared/entities/upgrades.ts\` instead.`,
		`</noinclude><includeonly>{| class="wikitable mw-collapsible" width="100%" border="1"`,
		`|+ Related Pages`,
		...sections,
		`|}</includeonly>`,
		``
	].join('\n');
}

// Walk every adjacent version pair in the hosted manifest, compute the diff
// for each (memoized to disk), and invert the result into a per-upgrade
// `ChangeRecord[]` keyed by upgrade ID.
export async function loadUpgradeChangelogHistory(): Promise<Map<string, ChangeRecord[]>> {
	const out = new Map<string, ChangeRecord[]>();
	let manifestVersions: IndexEntry[] = [];
	try {
		const idx = await fetchManifest();
		manifestVersions = idx.versions;
	} catch (e) {
		console.warn(
			`Warning: failed to fetch manifest for changelog generation; skipping. ${(e as Error).message}`
		);
		return out;
	}

	if (manifestVersions.length === 0) return out;

	const currentDump = readDump();
	const currentVersion = currentDump.gameVersion?.Version ?? null;

	const dumpCache = new Map<string, DataDump>();
	const loadDump = (version: string): DataDump => {
		const cached = dumpCache.get(version);
		if (cached) return cached;
		if (version === currentVersion) {
			dumpCache.set(version, currentDump);
			return currentDump;
		}
		const cachePath = dumpCachePath(version);
		if (!fs.existsSync(cachePath)) {
			throw new Error(
				`Internal: dump for ${version} not found at ${cachePath}; should have been pre-fetched.`
			);
		}
		const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as DataDump;
		dumpCache.set(version, parsed);
		return parsed;
	};

	for (const v of manifestVersions) {
		if (v.version === currentVersion) continue;
		try {
			await fetchVersionDump(v.version);
		} catch (e) {
			console.warn(
				`Warning: failed to fetch ${v.version}; will skip from changelog. ${(e as Error).message}`
			);
		}
	}

	const findEntry = (version: string) => manifestVersions.find((v) => v.version === version);

	const oldestFirst = [...manifestVersions].reverse();
	for (let i = 1; i < oldestFirst.length; i++) {
		const prev = oldestFirst[i - 1];
		const curr = oldestFirst[i];
		const currEntry = findEntry(curr.version);
		if (!currEntry) continue;

		let perUpgrade: Map<string, import('../dump-types').Change[]>;
		try {
			perUpgrade = cachedDiff(prev.version, curr.version, loadDump);
		} catch (e) {
			console.warn(
				`Warning: skipping diff ${prev.version} → ${curr.version}: ${(e as Error).message}`
			);
			continue;
		}

		for (const [upgradeID, changes] of perUpgrade) {
			if (changes.length === 0) continue;
			const list = out.get(upgradeID) ?? [];
			list.push({ version: curr.version, dumpedAt: curr.dumpedAt, changes });
			out.set(upgradeID, list);
		}
	}

	// Synthesize a baseline `* Added.` record for every upgrade present in the
	// oldest version we know about that has no other history entries. Reads as
	// "stable since at least vX" rather than "this page has no changelog data".
	const oldestEntry = oldestFirst[0];
	let oldestDump: DataDump | null = null;
	try {
		oldestDump = loadDump(oldestEntry.version);
	} catch {
		// Fall back gracefully: no synthesized baseline if we can't load it.
	}
	if (oldestDump) {
		const oldestIDs = new Set(Object.keys(oldestDump.upgrades ?? {}));
		for (const id of Object.keys(currentDump.upgrades ?? {})) {
			if (out.has(id)) continue;
			if (!oldestIDs.has(id)) continue;
			out.set(id, [
				{
					version: oldestEntry.version,
					dumpedAt: oldestEntry.dumpedAt,
					changes: [{ kind: 'added' }]
				}
			]);
		}
	}

	for (const list of out.values()) list.reverse();
	return out;
}

// Render the changelog section for a single upgrade given pre-loaded history.
export function renderUpgradeChangelog(
	history: Map<string, ChangeRecord[]>,
	upgrade: GenericGunUpgrade
): string {
	return renderChangelogSection(history.get(String(upgrade.ID)) ?? [], upgrade);
}

// Classifier config for the host-page uploader. Knows which sections are
// curator-territory, which placeholder phrases to ignore, etc.
export const UPGRADE_CLASSIFIER_CONFIG: EntityClassifierConfig = {
	placeholderPhrases: [`''Add additional acquisition details here.''`, `''To be written.''`],
	cannedAcquisitionPhrases: new Set(
		[
			'unlocked from the upgrade tree.',
			"earned through the gear's upgrade tree.",
			'drops randomly from any source.',
			'found in the world drop pool.',
			'awarded as a special drop.',
			'hidden in the upgrade browser until obtained.',
			'hidden from the upgrade browser.'
		].map((s) => s.toLowerCase())
	),
	curatorOnlySections: new Set(
		['mechanics', 'synergies', 'changelog', 'trivia', 'notes', 'bugs', 'lore'].map((s) =>
			s.toLowerCase()
		)
	),
	autoGenSections: new Set(['statistics', 'stats', 'properties', 'properties and stats']),
	infoboxStripPattern: /\{\{Upgrade Infobox[\s\S]*?\}\}/g
};

// Re-exports so callers can `import * from './entities/upgrades'`
export { loadUpgrades, safeFilename, displayFilename, mapGunName };
