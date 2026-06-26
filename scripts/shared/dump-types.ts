// Shared types for the hosted-data ↔ local-cache pipeline.
//
// `Index` / `IndexEntry` mirror the manifest schema published at
// https://mycopunk-data.pages.dev/index.json — see the data repo's README
// for the canonical definition.
//
// `ChangeRecord` and `Change` are the per-upgrade diff records produced
// by `dump-diff.ts` and consumed by `changelog-renderer.ts`.

export interface IndexEntry {
	version: string;
	buildId: string;
	dumpedAt: string; // ISO 8601 UTC
	dumperCommit: string;
	size: number; // bytes of the gzipped dump as served
	sha256: string; // sha256 of the gzipped dump as served
}

export interface Index {
	latest: string;
	schema: string;
	versions: IndexEntry[]; // sorted newest-first per the data repo's contract
}

export interface ChangeRecord {
	version: string;
	dumpedAt: string;
	changes: Change[];
}

export interface CostResourceChange {
	resourceID: string;
	resourceName: string;
	from: number;
	to: number;
}

export type Change =
	| { kind: 'added' }
	| { kind: 'renamed'; from: string; to: string }
	| { kind: 'description'; from: string; to: string }
	| { kind: 'field'; field: string; from: string; to: string }
	| { kind: 'list-add'; field: string; value: string }
	| { kind: 'list-remove'; field: string; value: string }
	| { kind: 'cost'; currency: 'Ouroboros' | 'Turbocharge'; changes: CostResourceChange[] }
	| { kind: 'stat'; property: string; stat: string; from: string; to: string }
	| { kind: 'stat-add'; property: string; stat: string }
	| { kind: 'stat-remove'; property: string; stat: string }
	| {
			kind: 'rolls';
			property: string;
			stat: string;
			fromMin: string;
			fromMax: string;
			toMin: string;
			toMax: string;
	  }
	| { kind: 'property-add'; property: string }
	| { kind: 'property-remove'; property: string };
