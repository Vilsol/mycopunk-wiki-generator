// Upgrade entity: loader, identification, formatter context, enrichment
// lookups, changelog assembly, related-pages template, and registry.

import fs from 'node:fs';
import {
	getPropertyStatRows,
	convertCode,
	convertCodeWiki,
	gunMappings,
	parseRGBA
} from '../upgrades/utils';
import type { GenericGunUpgrade, DataDump } from '../upgrades/types';
import type { AuthItem, SkillTreeNode } from '../data/schema.d';
import type { ChangeRecord, IndexEntry } from '../dump-types';
import { fetchManifest, fetchVersionDump, dumpCachePath } from '../dump-cache';
import { cachedDiff } from '../dump-diff-cache';
import { renderChangelogSection } from '../changelog-renderer';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName, stripHtml } from '../wiki-text';
import { defineEntity, lazyLoad } from '../entity-registry';

type SkillTreeNodeWithChar = SkillTreeNode & { character: string };

// ─────────────────────────────────────────────────────────────────────────
// Loader + identification
// ─────────────────────────────────────────────────────────────────────────

// Returns ALL upgrades including cosmetics. Most consumers want the
// non-cosmetic subset — that's what the registry's `loadItems` returns.
// `loadAllUpgrades()` is for cross-entity inversions (skill trees, skins,
// rarity tables) that need every entry.
export function loadUpgrades(): GenericGunUpgrade[] {
	const data = readDump();
	if (!data?.upgrades || typeof data.upgrades !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with an 'upgrades' property`);
	}
	return Object.values(data.upgrades) as GenericGunUpgrade[];
}

// Excludes cosmetics — what skins/upgrades-as-pages actually want. Cosmetic
// "upgrades" are skin variants; their `Name`s collide on the wiki ("Factory"
// applies to 23 gears, etc.) and they have no meaningful stat data, so they'd
// produce near-empty pages that overwrite each other. The `skins` entity
// catalogs those properly.
export function loadGameplayUpgrades(): GenericGunUpgrade[] {
	return loadUpgrades().filter((u) => u.UpgradeType !== 'Cosmetic');
}

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

export function upgradePageTitle(upgrade: GenericGunUpgrade): string {
	return `${stripHtml(upgrade.Name)} Upgrade`;
}

// ─────────────────────────────────────────────────────────────────────────
// Enrichment lookups
// ─────────────────────────────────────────────────────────────────────────

export interface UpgradeEnrichment {
	authItemsByUpgradeID: Map<string, AuthItem>;
	skillTreeByUpgradeID: Map<string, SkillTreeNodeWithChar>;
	upgradeNamesByID: Map<string, string>;
}

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

// ─────────────────────────────────────────────────────────────────────────
// Context builder (memoizes enrichment + changelog history)
// ─────────────────────────────────────────────────────────────────────────

const getEnrichment = lazyLoad(loadUpgradeEnrichment);
const getHistory = lazyLoad(loadUpgradeChangelogHistory); // returns Promise — caller awaits

export function buildUpgradeContextSync(
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

export async function buildUpgradeContext(
	upgrade: GenericGunUpgrade
): Promise<Record<string, unknown>> {
	const enrichment = getEnrichment();
	const history = await getHistory();
	const changelog = renderChangelogSection(history.get(String(upgrade.ID)) ?? [], upgrade);
	return buildUpgradeContextSync(upgrade, enrichment, changelog);
}

// ─────────────────────────────────────────────────────────────────────────
// Related-pages template (extra file emitted alongside source pages)
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// Changelog history
// ─────────────────────────────────────────────────────────────────────────

// Every upgrade present in the oldest tracked dump gets an `Added.` record
// at that version, prepended to its history — even when it has later
// changes. Lists here are oldest-first (pre-reverse), so the baseline is
// unshifted to the front. Mutates `history` in place.
export function prependBaselineRecords(
	history: Map<string, ChangeRecord[]>,
	currentUpgradeIDs: Iterable<string>,
	oldestUpgradeIDs: Set<string>,
	oldestEntry: { version: string; dumpedAt: string }
): void {
	for (const id of currentUpgradeIDs) {
		if (!oldestUpgradeIDs.has(id)) continue;
		const baseline: ChangeRecord = {
			version: oldestEntry.version,
			dumpedAt: oldestEntry.dumpedAt,
			changes: [{ kind: 'added' }]
		};
		const list = history.get(id);
		if (!list) history.set(id, [baseline]);
		else list.unshift(baseline);
	}
}

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

	const oldestEntry = oldestFirst[0];
	let oldestDump: DataDump | null = null;
	try {
		oldestDump = loadDump(oldestEntry.version);
	} catch {
		// no synthesized baseline if we can't load
	}
	if (oldestDump) {
		const oldestIDs = new Set(Object.keys(oldestDump.upgrades ?? {}));
		prependBaselineRecords(out, Object.keys(currentDump.upgrades ?? {}), oldestIDs, oldestEntry);
	}

	for (const list of out.values()) list.reverse();
	return out;
}

export function renderUpgradeChangelog(
	history: Map<string, ChangeRecord[]>,
	upgrade: GenericGunUpgrade
): string {
	return renderChangelogSection(history.get(String(upgrade.ID)) ?? [], upgrade);
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<GenericGunUpgrade>({
	name: 'upgrades',
	dumpKey: 'upgrades',
	loadItems: loadGameplayUpgrades,
	safeFilename,
	displayFilename,
	pageTitle: upgradePageTitle,
	identLabel: (u) => `${u.APIName} (ID: ${u.ID})`,
	infoboxDescription: (u) => u.Description ?? '',
	classifier: {
		placeholderPhrases: [`''Add additional acquisition details here.''`, `''To be written.''`],
		cannedAcquisitionPhrases: [
			'unlocked from the upgrade tree.',
			"earned through the gear's upgrade tree.",
			'drops randomly from any source.',
			'found in the world drop pool.',
			'awarded as a special drop.',
			'hidden in the upgrade browser until obtained.',
			'hidden from the upgrade browser.'
		],
		curatorOnlySections: ['mechanics', 'synergies', 'changelog', 'trivia', 'notes', 'bugs', 'lore'],
		autoGenSections: ['statistics', 'stats', 'properties', 'properties and stats'],
		infoboxStripPattern: /\{\{Upgrade Infobox[\s\S]*?\}\}/g
	},
	templateName: 'upgrade-source.wiki',
	skeletonTemplateName: 'upgrade-skeleton.wiki',
	contextBuilder: buildUpgradeContext,
	extraFiles: () => ({ '_Template_Related_Pages.wiki': buildRelatedPagesTemplate() }),
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (u) => `${displayFilename(u)}_Icon.png`,
			targetFilename: (u) => `${displayFilename(u)}_Icon.png`,
			description: (u) =>
				[
					`'''${u.Name}'''`,
					'',
					`Icon for the ${u.Name} upgrade in Mycopunk.`,
					'',
					`[[Category:Upgrade Icons]]`
				].join('\n')
		},
		{
			kind: 'pattern',
			sourceDirKind: 'svgs',
			suffix: '_Pattern.svg',
			localFilename: (u) => `${displayFilename(u)}_Pattern.svg`,
			targetFilename: (u) => `${displayFilename(u)}_Pattern.svg`,
			description: (u) =>
				[
					`'''${u.Name}'''`,
					'',
					`Hex pattern for the ${u.Name} upgrade in Mycopunk.`,
					'',
					`[[Category:Upgrade Patterns]]`
				].join('\n')
		}
	],
	icon: {
		// Each upgrade is alpha-masked onto a solid rect of its rarity color.
		getTexture: (u) => u.Icon ?? null,
		getTintColor: (u) => (u.Color ? parseRGBA(u.Color) : null)
	}
});
