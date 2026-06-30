// Disk-memoized wrapper around `diffDumps`. Inputs are version pairs; the
// hosted dumps are immutable per path, so the diff result is also
// immutable for any given pair and we can cache the JSON output forever.
//
// Cache validity is keyed on the mtime of the two input dump files (the
// cache files under `.dump-cache/<version>.json`). Re-fetching a dump
// touches the file's mtime; that bust the diff cache automatically.

import fs from 'node:fs';
import path from 'node:path';
import type { Change } from './dump-types.ts';
import { diffCachePath, dumpCachePath } from './dump-cache.ts';
import { diffDumps } from './dump-diff.ts';
import { ensureDir } from './paths.ts';
import type { DataDump } from './upgrades/types.ts';

// Bump whenever the `Change` shape emitted by `diffDumps` changes, so
// caches written by an older format are treated as stale and recomputed
// instead of being replayed (which would feed malformed records to the
// renderer). v2: `rolls` carries fromMin/fromMax/toMin/toMax (was
// added/removed). v3: categorical multi-key stats aggregate into `category`.
export const CHANGE_FORMAT_VERSION = 3;

interface CachedDiff {
	formatVersion: number;
	prevVersion: string;
	currVersion: string;
	prevMtimeMs: number;
	currMtimeMs: number;
	entries: [string, Change[]][];
}

// Pure freshness check: a cache is reusable only when its format version,
// version pair, and both dump mtimes all match what we expect.
export function isCachedDiffFresh(
	cached: Partial<CachedDiff> | null | undefined,
	expected: {
		prevVersion: string;
		currVersion: string;
		prevMtimeMs: number;
		currMtimeMs: number;
	}
): boolean {
	if (!cached) return false;
	return (
		cached.formatVersion === CHANGE_FORMAT_VERSION &&
		cached.prevVersion === expected.prevVersion &&
		cached.currVersion === expected.currVersion &&
		cached.prevMtimeMs === expected.prevMtimeMs &&
		cached.currMtimeMs === expected.currMtimeMs
	);
}

export function cachedDiff(
	prevVersion: string,
	currVersion: string,
	loadDump: (version: string) => DataDump
): Map<string, Change[]> {
	const cachePath = diffCachePath(prevVersion, currVersion);
	const prevDumpPath = dumpCachePath(prevVersion);
	const currDumpPath = dumpCachePath(currVersion);

	// Both dumps must exist on disk to compare mtimes. When either side
	// isn't in the cache yet, fall back to direct compute (don't cache
	// since we can't track its mtime reliably).
	const prevExists = fs.existsSync(prevDumpPath);
	const currExists = fs.existsSync(currDumpPath);
	if (!prevExists || !currExists) {
		return diffDumps(loadDump(prevVersion) as never, loadDump(currVersion) as never);
	}

	const prevMtimeMs = fs.statSync(prevDumpPath).mtimeMs;
	const currMtimeMs = fs.statSync(currDumpPath).mtimeMs;

	if (fs.existsSync(cachePath)) {
		try {
			const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CachedDiff;
			if (isCachedDiffFresh(cached, { prevVersion, currVersion, prevMtimeMs, currMtimeMs })) {
				return new Map(cached.entries);
			}
		} catch {
			// Corrupt cache; recompute.
		}
	}

	const result = diffDumps(loadDump(prevVersion) as never, loadDump(currVersion) as never);
	const payload: CachedDiff = {
		formatVersion: CHANGE_FORMAT_VERSION,
		prevVersion,
		currVersion,
		prevMtimeMs,
		currMtimeMs,
		entries: [...result.entries()]
	};
	ensureDir(path.dirname(cachePath));
	fs.writeFileSync(cachePath, JSON.stringify(payload));
	return result;
}
