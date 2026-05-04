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

interface CachedDiff {
	prevVersion: string;
	currVersion: string;
	prevMtimeMs: number;
	currMtimeMs: number;
	entries: [string, Change[]][];
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
			if (
				cached.prevVersion === prevVersion &&
				cached.currVersion === currVersion &&
				cached.prevMtimeMs === prevMtimeMs &&
				cached.currMtimeMs === currMtimeMs
			) {
				return new Map(cached.entries);
			}
		} catch {
			// Corrupt cache; recompute.
		}
	}

	const result = diffDumps(loadDump(prevVersion) as never, loadDump(currVersion) as never);
	const payload: CachedDiff = {
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
