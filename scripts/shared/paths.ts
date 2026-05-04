import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function getScriptDir(importMetaUrl: string): string {
	return path.dirname(fileURLToPath(importMetaUrl));
}

// Walk up from the calling script's directory looking for package.json. Robust
// to caller location: works from scripts/<file>.ts and scripts/shared/<file>.ts
// alike. The previous fixed `../..` only resolved correctly for callers in
// scripts/shared/ — sync-data.ts (in scripts/) was silently writing data.json
// into the project's parent directory.
export function getProjectRoot(importMetaUrl: string): string {
	let dir = getScriptDir(importMetaUrl);
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`Could not find package.json above ${getScriptDir(importMetaUrl)}`);
}

export function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

export type EntityKind = 'wiki-source' | 'icons' | 'svgs';

const ENTITY_DIRS: Record<EntityKind, string> = {
	'wiki-source': 'generated-wiki-source',
	icons: 'generated-icons',
	svgs: 'generated-svgs'
};

// Output dir for a given entity (e.g. "upgrades", "gears") and artifact kind.
// Layout: <projectRoot>/<top-level>/<entityType>/.
export function entityOutputDir(
	importMetaUrl: string,
	entityType: string,
	kind: EntityKind
): string {
	return path.join(getProjectRoot(importMetaUrl), ENTITY_DIRS[kind], entityType);
}

// Curator-managed config files for an entity (force-overwrite-titles.txt etc.)
// live under top-level `wiki-config/<entity>/`. Kept separate from the
// generated tree so the latter can stay gitignored without losing
// hand-edited curator state.
export function entityConfigDir(importMetaUrl: string, entityType: string): string {
	return path.join(getProjectRoot(importMetaUrl), 'wiki-config', entityType);
}
