// Fetch + cache versioned game-data dumps from the hosted repo. Hosted
// paths are immutable, so a successful fetch can be cached forever per
// version.
//
// `.dump-cache/<version>.json` is the addressable per-version snapshot.
// `.dump-cache/current` is a one-line pointer file holding the active
// version string — `readDump()` follows it to find the dump every script
// reads. `.dump-cache/schema.json` is the matching JSON schema.
// Network failures fall back to the cached copy when one exists.

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { DataDump } from './upgrades/types.ts';
import type { Index } from './dump-types.ts';
import { ensureDir, getProjectRoot } from './paths.ts';

const PROJECT_ROOT = getProjectRoot(import.meta.url);
const BASE_URL = 'https://mycopunk-data.pages.dev';
const CACHE_DIR = path.join(PROJECT_ROOT, '.dump-cache');

export async function fetchManifest(): Promise<Index> {
	const res = await fetch(`${BASE_URL}/index.json`);
	if (!res.ok) {
		throw new Error(`GET ${BASE_URL}/index.json → ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as Index;
}

// Fetch a parsed dump for the given version. Hits the on-disk cache when
// available; otherwise downloads the gzipped dump, decompresses, and
// writes both the parsed JSON and the raw gzip into the cache directory.
// On network failure, falls back to the cached copy if one exists.
export async function fetchVersionDump(version: string): Promise<DataDump> {
	const cachePath = path.join(CACHE_DIR, `${version}.json`);
	if (fs.existsSync(cachePath)) {
		try {
			return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as DataDump;
		} catch {
			// Corrupted cache; re-download below.
			console.warn(`Cached dump for ${version} corrupt; re-fetching.`);
		}
	}

	const url = `${BASE_URL}/data/${version}/data.json.gz`;
	let res: Response;
	try {
		res = await fetch(url);
	} catch (e) {
		throw new Error(
			`Network failure fetching ${url} (no cache available): ${(e as Error).message}`
		);
	}
	if (!res.ok) {
		throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
	}
	const gz = Buffer.from(await res.arrayBuffer());
	const json = gunzipSync(gz).toString('utf8');
	const parsed = JSON.parse(json) as DataDump;

	ensureDir(CACHE_DIR);
	fs.writeFileSync(cachePath, json);
	return parsed;
}

// Path for diff caches keyed by ordered version pair.
export function diffCachePath(prevVersion: string, currVersion: string): string {
	return path.join(CACHE_DIR, `diff-${prevVersion}-${currVersion}.json`);
}

// Path for a version's cached parsed dump.
export function dumpCachePath(version: string): string {
	return path.join(CACHE_DIR, `${version}.json`);
}

// Active-version pointer: a one-line text file at `.dump-cache/current`
// holding the version string (e.g. `v1.8.2`). `sync-data.ts` writes this;
// `readDump()` reads it to locate the active dump.
const CURRENT_PATH = path.join(CACHE_DIR, 'current');

export function getCurrentVersion(): string | null {
	if (!fs.existsSync(CURRENT_PATH)) return null;
	const v = fs.readFileSync(CURRENT_PATH, 'utf8').trim();
	return v || null;
}

export function setCurrentVersion(version: string): void {
	ensureDir(CACHE_DIR);
	fs.writeFileSync(CURRENT_PATH, version);
}

// Active schema lives alongside the dump cache, version-pinned-by-pointer
// rather than per-version. `sync-data.ts` overwrites it on every sync.
export function currentSchemaPath(): string {
	return path.join(CACHE_DIR, 'schema.json');
}
