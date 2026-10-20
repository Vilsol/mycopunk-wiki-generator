// Planet entity. One page per planet; the planet's regions are sections on
// that page (they are too thin for pages of their own: a description, a
// threat range and a handful of flags) and its missions are a table.

import type { Region } from '../data/schema.d';
import { readDump } from '../dump';
import { escapeWikiText, normalizeWikiTitle, sanitizeAPIName, plainText } from '../wiki-text';
import { defineEntity, lazyLoad } from '../entity-registry';
import {
	loadPlanets,
	loadRegions,
	missionRegions,
	planetTitle,
	regionName,
	type PlanetWithKey
} from '../load-world';
import { getModifiersByID, modifierLink } from './mission-modifiers';
import { loadMissions, missionPageTitle, isPlaceholderName } from './missions';
import type { MissionEntry } from './missions';

// ─────────────────────────────────────────────────────────────────────────
// Identification
// ─────────────────────────────────────────────────────────────────────────

export function safeFilename(planet: PlanetWithKey): string {
	return sanitizeAPIName(planet.key);
}

export function displayFilename(planet: PlanetWithKey): string {
	return normalizeWikiTitle(sanitizeAPIName(planetTitle(planet) || planet.key));
}

export function planetPageTitle(planet: PlanetWithKey): string {
	return planetTitle(planet) || planet.key;
}

// ─────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ['Main', 'Special', 'Story', 'Roguelike', 'Secret'];

function threatRange(region: Region): string {
	const min = region.MinThreat ?? 0;
	const max = region.MaxThreat ?? 7;
	return max >= min ? `${min}–${max}` : `${min}+`;
}

function buildRegionBlock(region: Region): string {
	const out: string[] = [`=== ${escapeWikiText(regionName(region))} ===`];
	const description = plainText(region.LocalizedDescription).trim();
	if (description) out.push(escapeWikiText(description), '');
	out.push(`* Threat levels: ${threatRange(region)}`);

	const locations = (region.WorldProfiles ?? [])
		.map((p) => plainText(p.LocationName).trim())
		.filter((n) => n.length > 0);
	if (locations.length > 0) {
		out.push(`* Locations: ${[...new Set(locations)].map(escapeWikiText).join(', ')}`);
	}

	const modifiersByID = getModifiersByID();
	const modifiers = (region.DefaultModifiers ?? [])
		.map((key) => modifiersByID.get(Number(key)))
		.filter((m): m is NonNullable<typeof m> => !!m);
	if (modifiers.length > 0) {
		out.push(`* Default modifiers: ${modifiers.map(modifierLink).join(', ')}`);
	}
	if (region.ExcludeFromOvertimeAssignment) {
		out.push('* Not used for weekly overtime assignments');
	}
	return out.join('\n');
}

function missionsOnPlanet(regions: Region[]): MissionEntry[] {
	return loadMissions()
		.filter((m) => !isPlaceholderName(m))
		.filter((m) => {
			const mr = missionRegions(m.CompatibleLevels, m.RawData, loadRegions());
			return mr.all || mr.regions.some((r) => regions.includes(r));
		})
		.sort(
			(a, b) =>
				CATEGORY_ORDER.indexOf(a.Category ?? '') - CATEGORY_ORDER.indexOf(b.Category ?? '') ||
				missionPageTitle(a).localeCompare(missionPageTitle(b))
		);
}

function buildMissionsTable(missions: MissionEntry[]): string {
	if (missions.length === 0) return '';
	const out = ['{| class="wikitable"', '! Mission !! Category !! Min level'];
	for (const m of missions) {
		out.push('|-');
		out.push(`| [[${missionPageTitle(m)}]] || ${m.Category ?? '—'} || ${m.MinLevelToStart || '—'}`);
	}
	out.push('|}');
	return out.join('\n');
}

export function buildPlanetContext(planet: PlanetWithKey): Record<string, unknown> {
	const regions = loadRegions().filter((r) => r.Planet === planet.key);
	const regionsSection = regions.map(buildRegionBlock).join('\n\n');
	const missionsSection = buildMissionsTable(missionsOnPlanet(regions));
	const subtitle = plainText(planet.Subtitle).trim();
	const dailyRegion = planet.DailyModifierRegion
		? loadRegions().find((r) => String(r.ID) === planet.DailyModifierRegion)
		: undefined;
	const name = planetPageTitle(planet);

	return {
		name: escapeWikiText(name),
		pageTitle: name,
		apiName: escapeWikiText(planet.key),
		subtitle: escapeWikiText(subtitle),
		minLevel: planet.MinLevel ?? 0,
		hazardous: planet.IsHazardous ? 'Yes' : 'No',
		regionCount: regions.length,
		dailyModifierRegion: dailyRegion ? escapeWikiText(regionName(dailyRegion)) : '',
		icon: `${displayFilename(planet)}_Icon.png`,
		seoDescription: `${name}${subtitle ? `, ${subtitle}` : ''} — a planet in Mycopunk with ${regions.length} region${regions.length === 1 ? '' : 's'}.`,
		regionsSection,
		hasRegions: regionsSection.length > 0,
		missionsSection,
		hasMissions: missionsSection.length > 0
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Registry definition
// ─────────────────────────────────────────────────────────────────────────

export const entity = defineEntity<PlanetWithKey>({
	name: 'planets',
	dumpKey: 'planets',
	loadItems: loadPlanets,
	safeFilename,
	displayFilename,
	pageTitle: planetPageTitle,
	identLabel: (p) => `${p.key} (${p.Name ?? '(no name)'})`,
	classifier: {
		placeholderPhrases: [`''To be written.''`],
		curatorOnlySections: ['lore', 'trivia', 'notes', 'patch history'],
		autoGenSections: ['regions', 'missions', 'overview'],
		infoboxTemplateName: 'Infobox planet'
	},
	templateName: 'planet-source.wiki',
	skeletonTemplateName: 'planet-skeleton.wiki',
	contextBuilder: buildPlanetContext,
	fileTypes: [
		{
			kind: 'icon',
			sourceDirKind: 'icons',
			suffix: '_Icon.png',
			localFilename: (p) => `${displayFilename(p)}_Icon.png`,
			targetFilename: (p) => `${displayFilename(p)}_Icon.png`,
			description: (p) =>
				[
					`'''${planetPageTitle(p)}'''`,
					'',
					`Icon for the planet ${planetPageTitle(p)} in Mycopunk.`,
					'',
					`[[Category:Planet Icons]]`
				].join('\n')
		}
	],
	icon: {
		getTexture: (p) => p.Icon ?? null
	}
});
