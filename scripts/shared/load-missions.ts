import type { MissionEntry as SchemaMissionEntry } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName } from './wiki-text';

// `PlainName` and `Index` are present on every dump mission entry but the
// upstream JSON schema (and therefore the generated `MissionEntry`) doesn't
// declare them. Extend locally so consumers stay strict-typed without
// hand-patching the auto-generated schema file on every sync.
export type MissionEntry = SchemaMissionEntry & {
	PlainName?: string;
	Index?: number;
};

// `???` is the placeholder PlainName the game uses for discovery-locked or
// debug missions. Two such entries exist (IDs `??` and `???`). Both are kept
// in the loader; the page title disambiguates via Subclass (e.g.
// `??? (PanelMission)`) since `???` alone would collide and isn't a usable
// wiki title anyway.
function isPlaceholderName(m: MissionEntry): boolean {
	return (m.PlainName ?? '').trim() === '???';
}

export function loadMissions(): MissionEntry[] {
	const data = readDump() as unknown as { missions?: Record<string, MissionEntry> };
	if (!data?.missions || typeof data.missions !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'missions' property`);
	}
	// Require some name signal at all. Beyond that we keep everything,
	// including placeholder `???` entries (disambiguated downstream).
	return Object.values(data.missions)
		.filter((m) => (m.PlainName ?? m.MissionName ?? m.ID ?? '').trim().length > 0)
		.sort((a, b) => missionPageTitle(a).localeCompare(missionPageTitle(b)));
}

export function safeFilename(m: MissionEntry): string {
	// ID is the dump key and uniquely identifies a mission; placeholder IDs
	// like `??` would sanitize to all-underscores, so fall back to a stable
	// `mission_<n>_<subclass>` form in that case.
	const sanitizedId = sanitizeAPIName(m.ID);
	if (/[a-zA-Z0-9]/.test(sanitizedId)) return sanitizedId;
	return `mission_idx${m.Index ?? 0}_${sanitizeAPIName(m.Subclass)}`;
}

export function displayFilename(m: MissionEntry): string {
	if (isPlaceholderName(m)) {
		// "??? (PanelMission)" → "Unknown_PanelMission" for filesystem/wiki safety.
		return normalizeWikiTitle(`Unknown_${sanitizeAPIName(m.Subclass)}`);
	}
	const name = (m.PlainName ?? m.MissionName ?? m.ID).trim();
	if (!/[a-zA-Z0-9]/.test(name)) return safeFilename(m);
	return normalizeWikiTitle(sanitizeAPIName(name));
}

export function missionPageTitle(m: MissionEntry): string {
	if (isPlaceholderName(m)) {
		// Disambiguate the two placeholder missions by their Subclass since
		// PlainName collides ("??? (PanelMission)" vs "??? (FlatTundraMission)").
		return `??? (${m.Subclass})`;
	}
	return (m.PlainName ?? m.MissionName ?? m.ID).trim();
}
