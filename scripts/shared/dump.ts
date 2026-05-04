import fs from 'node:fs';
import type { DataDump } from './upgrades/types';
import { dumpCachePath, getCurrentVersion } from './dump-cache';

let cached: DataDump | null = null;

export function readDump(): DataDump {
	if (cached) return cached;
	const version = getCurrentVersion();
	if (!version) {
		throw new Error(
			'No active dump version. Run `mise run release:sync` to populate .dump-cache/.'
		);
	}
	const dataPath = dumpCachePath(version);
	if (!fs.existsSync(dataPath)) {
		throw new Error(
			`Dump for active version ${version} missing at ${dataPath}. Run \`mise run release:sync\`.`
		);
	}
	cached = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as DataDump;
	return cached;
}

export function loadGameVersion(): string {
	return readDump().gameVersion?.Version ?? 'unknown';
}
