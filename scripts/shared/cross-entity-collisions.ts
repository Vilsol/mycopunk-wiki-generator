// Names that exist on more than one entity in the dump and therefore need to
// be disambiguated by entity kind in their wiki page title and icon filename.
//
// When you see a clash, add the bare name here. Both colliding entities will
// then suffix their page title and icon filename with their entity kind,
// e.g. "Yeuco (Resource)" / "Yeuco_Resource_Icon.png" and
// "Yeuco (Status Effect)" / "Yeuco_Status_Effect_Icon.png". A curator can
// add a plain `Yeuco` redirect or disambiguation page on the wiki.
export const COLLIDING_NAMES: ReadonlySet<string> = new Set([
	'Yeuco' // resource `yeuco` ⇄ status effect `el_yeuco`
]);

export function isColliding(name: string | undefined): boolean {
	if (!name) return false;
	return COLLIDING_NAMES.has(name);
}

// Suffix policy. Entity kind names appear in both the page title (with
// parentheses, human-readable: " (Resource)") and the file basename
// (with underscores: "_Resource"). Keep the two in sync via this helper.
export interface EntitySuffix {
	titleSuffix: string; // e.g. " (Resource)"
	filenameSuffix: string; // e.g. "_Resource"
}

export const RESOURCE_SUFFIX: EntitySuffix = {
	titleSuffix: ' (Resource)',
	filenameSuffix: '_Resource'
};

export const STATUS_EFFECT_SUFFIX: EntitySuffix = {
	titleSuffix: ' (Status Effect)',
	filenameSuffix: '_Status_Effect'
};
