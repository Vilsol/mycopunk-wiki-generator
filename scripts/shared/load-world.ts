// Planets, regions and events: dump loaders plus the title/anchor helpers
// shared by the planets entity, the events entity and the mission enrichment.
// Regions have no pages of their own — they are sections on their planet's
// page, so a region link is `[[<Planet>#<Region>|<Region>]]`.

import type { GlobalEvent, MissionEvent, PlanetEntry, Region } from './data/schema.d';
import { readDump } from './dump';
import { plainText } from './wiki-text';

export type PlanetWithKey = PlanetEntry & { key: string };

export const EVENTS_PAGE = 'Events';

interface WorldDump {
	planets?: Record<string, PlanetEntry>;
	regions?: Record<string, Region>;
	globalEvents?: Record<string, GlobalEvent>;
	missionEvents?: Record<string, MissionEvent>;
}

function world(): WorldDump {
	return readDump() as unknown as WorldDump;
}

export function loadPlanets(): PlanetWithKey[] {
	return Object.entries(world().planets ?? {})
		.map(([key, p]) => ({ ...p, key }))
		.sort((a, b) => (a.MinLevel ?? 0) - (b.MinLevel ?? 0) || a.key.localeCompare(b.key));
}

export function loadRegions(): Region[] {
	return Object.values(world().regions ?? {}).sort((a, b) => a.ID - b.ID);
}

export function loadGlobalEvents(): GlobalEvent[] {
	return Object.values(world().globalEvents ?? {}).sort((a, b) => a.ID.localeCompare(b.ID));
}

export function loadMissionEvents(): MissionEvent[] {
	return Object.values(world().missionEvents ?? {}).sort((a, b) => (a.Index ?? 0) - (b.Index ?? 0));
}

export function planetTitle(planet: PlanetEntry): string {
	return plainText(planet.Name).trim();
}

export function regionName(region: Region): string {
	return plainText(region.RegionName ?? region.NameID).trim();
}

export function regionLink(region: Region, planetsByKey: Map<string, PlanetWithKey>): string {
	const name = regionName(region);
	const planet = region.Planet ? planetsByKey.get(region.Planet) : undefined;
	return planet ? `[[${planetTitle(planet)}#${name}|${name}]]` : name;
}

// LevelFlags tokens that identify a region (its own flag, e.g. `Tundra`),
// minus the generic spawn/procedural ones shared between regions.
function regionFlagTokens(region: Region): string[] {
	return (region.Flags ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t && t !== 'Procedural' && !t.startsWith('Spawn'));
}

export type MissionRegions = { all: true } | { all: false; regions: Region[] };

// Regions a mission can be played in: `CompatibleLevels` flag tokens, or the
// explicit `region` ref in RawData (Amalgamation Hunt is pinned to one region).
export function missionRegions(
	compatibleLevels: string | undefined,
	rawData: unknown,
	regions: Region[]
): MissionRegions {
	const tokens = (compatibleLevels ?? '').split(',').map((t) => t.trim());
	if (tokens.includes('AllRegions')) return { all: true };
	const pinned = (rawData as { region?: { '@ref'?: string } } | undefined)?.region?.['@ref'];
	const pinnedId = pinned?.startsWith('region:') ? pinned.slice('region:'.length) : undefined;
	return {
		all: false,
		regions: regions.filter(
			(r) => String(r.ID) === pinnedId || regionFlagTokens(r).some((t) => tokens.includes(t))
		)
	};
}

// `ge_amalgamation` → `Amalgamation`; the dump carries no display titles.
export function globalEventTitle(ge: GlobalEvent): string {
	const base = ge.ID.replace(/^ge_/, '').replace(/_/g, ' ');
	return base.charAt(0).toUpperCase() + base.slice(1);
}

// `RocketPassover` → `Rocket Passover event`, `WeatherMissionEvent` → `Weather event`
// (the suffix keeps the heading distinct from a same-named global event).
export function missionEventTitle(me: MissionEvent): string {
	const sub = (me.Subclass ?? me.Name).replace(/MissionEvent$/, '');
	return `${sub.replace(/([a-z])([A-Z])/g, '$1 $2')} event`;
}

export function globalEventLink(ge: GlobalEvent): string {
	const title = globalEventTitle(ge);
	return `[[${EVENTS_PAGE}#${title}|${title}]]`;
}
