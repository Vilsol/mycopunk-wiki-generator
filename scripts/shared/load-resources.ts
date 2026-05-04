import type { Resource } from './data/schema.d';
import { readDump } from './dump';
import { normalizeWikiTitle, sanitizeAPIName, stripHtml } from './wiki-text';
import { isColliding, RESOURCE_SUFFIX } from './cross-entity-collisions';

export function loadResources(): Resource[] {
	const data = readDump() as unknown as { resources?: Record<string, Resource> };
	if (!data?.resources || typeof data.resources !== 'object') {
		throw new Error(`Invalid data.json shape: expected an object with a 'resources' property`);
	}
	return Object.values(data.resources);
}

// Names may contain rich-text wrappers (e.g. `<font=H>Strange Components</font>`).
// Use the plain name for everything user-facing — page titles, file names,
// wikilinks.
export function plainName(resource: Resource): string {
	return stripHtml(resource.Name ?? resource.ID).trim();
}

export function safeFilename(resource: Resource): string {
	return sanitizeAPIName(resource.ID);
}

export function displayFilename(resource: Resource): string {
	const name = plainName(resource);
	if (!name || !/[a-zA-Z0-9]/.test(name)) return sanitizeAPIName(resource.ID);
	const base = normalizeWikiTitle(sanitizeAPIName(name));
	return isColliding(name) ? `${base}${RESOURCE_SUFFIX.filenameSuffix}` : base;
}

export function resourcePageTitle(resource: Resource): string {
	const name = plainName(resource);
	return isColliding(name) ? `${name}${RESOURCE_SUFFIX.titleSuffix}` : name;
}
