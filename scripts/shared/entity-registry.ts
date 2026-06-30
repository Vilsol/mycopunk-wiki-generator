// Single source of truth for the per-entity surface area: how to load it,
// how to name files for it, how to title its wiki page, how to classify
// its host page, what files (icons/patterns/etc.) to upload, and which
// templates feed its source/skeleton wiki output.
//
// Each entity ships a `defineEntity<T>({...})` block in its
// `entities/<name>.ts` module. This file imports them all lazily so
// adding an entity is a one-spot edit (a new entry in `ENTITIES` and
// the new entity module).
//
// Downstream consumers (upload-wiki, upload-files, generate.ts,
// generate-icons.ts) read entity capabilities exclusively through
// `getEntity(name)` and `knownEntities()`.

import type { DIcon } from './data/schema';
import type { EntityClassifierConfig, EntityFileSpec, EntityUploadConfig } from './upload-pipeline';
import type { RGBColor } from './icon-extractor';
import { readDump } from './dump';
import { finalTitle, titleKey } from './title-resolver.ts';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface ClassifierSpec {
	placeholderPhrases: string[];
	cannedAcquisitionPhrases?: string[]; // lowercased on materialization
	curatorOnlySections: string[]; // lowercased on materialization
	autoGenSections: string[]; // lowercased on materialization
	// Provide either a single template name (regex auto-built from it) OR a
	// hand-rolled regex when the entity has multiple legacy template names.
	infoboxTemplateName?: string; // e.g. 'Infobox gear', 'Upgrade Infobox'
	infoboxStripPattern?: RegExp; // escape hatch — wins if both are set
	botEmittedPatterns?: RegExp[];
}

export interface IconSpec<T> {
	getTexture: (item: T) => DIcon | null | undefined;
	getTintColor?: (item: T) => RGBColor | null | undefined;
}

export interface EntityDefinition<T> {
	// === Identity ===
	name: string; // CLI/path slug, e.g. 'status-effects'
	dumpKey: string; // top-level key in the dump JSON, e.g. 'statusEffects'

	// === Loader ===
	loadItems: () => T[];

	// === Identification ===
	safeFilename: (item: T) => string; // *.source.wiki / *.skeleton.wiki basename
	displayFilename: (item: T) => string; // for File: uploads (icons, patterns, …)
	pageTitle: (item: T) => string; // base title (collision resolution wraps this)
	disambiguationLabel?: (item: T) => string; // suffix label when this entity loses a collision
	identLabel?: (item: T) => string; // for log lines (default: safeFilename)
	infoboxDescription?: (item: T) => string; // for classifier preamble (default: '')

	// === Classifier ===
	classifier: ClassifierSpec;

	// === Wiki source generation ===
	templateName: string; // e.g. 'gear-source.wiki'
	skeletonTemplateName?: string; // e.g. 'gear-skeleton.wiki' (optional)
	contextBuilder: (item: T) => Record<string, unknown> | Promise<Record<string, unknown>>;
	extraFiles?: () => Record<string, string>; // shared helper templates

	// === Upload-time file emission ===
	// If omitted and `icon` is given, defaults to a single icon file type.
	// If neither is given, fileTypes is empty (entity has no uploaded files).
	fileTypes?: EntityFileSpec<T>[];

	// === Icon extraction (optional; only entities with sprites supply it) ===
	icon?: IconSpec<T>;
}

// Materialized form: defaults applied, classifier converted to Set form,
// upload-config object pre-built so consumers don't redo the work.
export interface MaterializedEntity<T> {
	name: string;
	dumpKey: string;
	loadItems: () => T[];
	safeFilename: (item: T) => string;
	displayFilename: (item: T) => string;
	pageTitle: (item: T) => string; // collision-resolved
	basePageTitle: (item: T) => string; // raw, pre-resolution (used by the resolver)
	disambiguationLabel?: (item: T) => string;
	identLabel: (item: T) => string;
	classifier: EntityClassifierConfig;
	templateName: string;
	skeletonTemplateName?: string;
	contextBuilder: (item: T) => Record<string, unknown> | Promise<Record<string, unknown>>;
	extraFiles?: () => Record<string, string>;
	fileTypes: EntityFileSpec<T>[];
	icon?: IconSpec<T>;
	uploadConfig: EntityUploadConfig<T>;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers exposed to entity modules
// ─────────────────────────────────────────────────────────────────────────

// Standard "Object.values(dump[dumpKey])" loader with optional filter+sort.
// Throws a descriptive error if the dump key is missing or wrong shape.
export function loadFromDump<T>(opts: {
	dumpKey: string;
	filter?: (item: T) => boolean;
	sort?: (a: T, b: T) => number;
}): () => T[] {
	return () => {
		const data = readDump() as unknown as Record<string, Record<string, T> | undefined>;
		const bucket = data[opts.dumpKey];
		if (!bucket || typeof bucket !== 'object') {
			throw new Error(`Invalid dump shape: expected an object with a '${opts.dumpKey}' property`);
		}
		let items = Object.values(bucket);
		if (opts.filter) items = items.filter(opts.filter);
		if (opts.sort) items = items.sort(opts.sort);
		return items;
	};
}

// Module-level memoization for cross-entity lookups: wraps any zero-arg
// function so its first call computes and every subsequent call returns
// the cached value. Handles falsy returns correctly (the `??=` shorthand
// would re-compute when the cached value is null/undefined/0).
//
// Usage in entity modules:
//   const getUpgradesByID = lazyLoad(loadUpgradesByID);
//   // …in contextBuilder…
//   const map = getUpgradesByID();
export function lazyLoad<T>(fn: () => T): () => T {
	let cached: T;
	let computed = false;
	return () => {
		if (!computed) {
			cached = fn();
			computed = true;
		}
		return cached;
	};
}

// Standard icon file spec: localFilename === targetFilename === `<displayFilename>_Icon.png`,
// description is a small wikitext block with a category tag.
export function defaultIconFileType<T>(opts: {
	displayFilename: (item: T) => string;
	prettyName: (item: T) => string;
	categoryName: string; // e.g. 'Status Effect Icons'
	entityLabelSingular: string; // e.g. 'status effect'
}): EntityFileSpec<T> {
	return {
		kind: 'icon',
		sourceDirKind: 'icons',
		suffix: '_Icon.png',
		localFilename: (item) => `${opts.displayFilename(item)}_Icon.png`,
		targetFilename: (item) => `${opts.displayFilename(item)}_Icon.png`,
		description: (item) =>
			[
				`'''${opts.prettyName(item)}'''`,
				'',
				`Icon for the ${opts.prettyName(item)} ${opts.entityLabelSingular} in Mycopunk.`,
				'',
				`[[Category:${opts.categoryName}]]`
			].join('\n')
	};
}

// ─────────────────────────────────────────────────────────────────────────
// defineEntity: applies defaults, builds materialized form
// ─────────────────────────────────────────────────────────────────────────

function lower(s: string): string {
	return s.toLowerCase();
}

// Convert a template name into a regex that strips the entire {{Template …}}
// invocation. Mirrors the per-entity `infoboxStripPattern` regexes.
function infoboxStripPatternFor(templateName: string): RegExp {
	const escaped = templateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\{\\{${escaped}[\\s\\S]*?\\}\\}`, 'g');
}

export function defineEntity<T>(def: EntityDefinition<T>): MaterializedEntity<T> {
	const identLabel = def.identLabel ?? def.safeFilename;
	const infoboxDescription = def.infoboxDescription ?? (() => '');

	const stripPattern =
		def.classifier.infoboxStripPattern ??
		(def.classifier.infoboxTemplateName
			? infoboxStripPatternFor(def.classifier.infoboxTemplateName)
			: undefined);
	if (!stripPattern) {
		throw new Error(
			`Entity '${def.name}': classifier must set infoboxTemplateName or infoboxStripPattern`
		);
	}

	const classifier: EntityClassifierConfig = {
		placeholderPhrases: def.classifier.placeholderPhrases,
		cannedAcquisitionPhrases: new Set((def.classifier.cannedAcquisitionPhrases ?? []).map(lower)),
		curatorOnlySections: new Set(def.classifier.curatorOnlySections.map(lower)),
		autoGenSections: new Set(def.classifier.autoGenSections.map(lower)),
		infoboxStripPattern: stripPattern,
		botEmittedPatterns: def.classifier.botEmittedPatterns
	};

	const fileTypes = def.fileTypes ?? [];

	const basePageTitle = def.pageTitle;
	const resolvedPageTitle = (item: T): string =>
		finalTitle(titleKey(def.name, def.safeFilename(item)), basePageTitle(item));

	const uploadConfig: EntityUploadConfig<T> = {
		name: def.name,
		loadItems: def.loadItems,
		pageTitle: resolvedPageTitle,
		basePageTitle,
		safeFilename: def.safeFilename,
		infoboxDescription,
		identLabel,
		classifier,
		fileTypes
	};

	return {
		name: def.name,
		dumpKey: def.dumpKey,
		loadItems: def.loadItems,
		safeFilename: def.safeFilename,
		displayFilename: def.displayFilename,
		pageTitle: resolvedPageTitle,
		basePageTitle,
		disambiguationLabel: def.disambiguationLabel,
		identLabel,
		classifier,
		templateName: def.templateName,
		skeletonTemplateName: def.skeletonTemplateName,
		contextBuilder: def.contextBuilder,
		extraFiles: def.extraFiles,
		fileTypes,
		icon: def.icon,
		uploadConfig
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Lazy registry: one entry per entity, lazy-imported from its module
// ─────────────────────────────────────────────────────────────────────────

type EntityLoader = () => Promise<MaterializedEntity<unknown>>;

// Adding a new entity: write `entities/<name>.ts` with `export const entity =
// defineEntity({...})`, then add a line here.
const ENTITIES: Record<string, EntityLoader> = {
	'status-effects': async () =>
		(await import('./entities/status-effects')).entity as MaterializedEntity<unknown>,
	threats: async () => (await import('./entities/threats')).entity as MaterializedEntity<unknown>,
	collectables: async () =>
		(await import('./entities/collectables')).entity as MaterializedEntity<unknown>,
	rarities: async () => (await import('./entities/rarities')).entity as MaterializedEntity<unknown>,
	resources: async () =>
		(await import('./entities/resources')).entity as MaterializedEntity<unknown>,
	crafting: async () => (await import('./entities/crafting')).entity as MaterializedEntity<unknown>,
	directives: async () =>
		(await import('./entities/directives')).entity as MaterializedEntity<unknown>,
	enemies: async () => (await import('./entities/enemies')).entity as MaterializedEntity<unknown>,
	upgrades: async () => (await import('./entities/upgrades')).entity as MaterializedEntity<unknown>,
	gears: async () => (await import('./entities/gears')).entity as MaterializedEntity<unknown>,
	characters: async () =>
		(await import('./entities/characters')).entity as MaterializedEntity<unknown>,
	missions: async () => (await import('./entities/missions')).entity as MaterializedEntity<unknown>,
	skins: async () => (await import('./entities/skins')).entity as MaterializedEntity<unknown>,
	'upgrade-presets': async () =>
		(await import('./entities/upgrade-presets')).entity as MaterializedEntity<unknown>
};

export async function getEntity(name: string): Promise<MaterializedEntity<unknown>> {
	const loader = ENTITIES[name];
	if (!loader) {
		throw new Error(`Unknown entity '${name}'. Known: ${Object.keys(ENTITIES).sort().join(', ')}`);
	}
	return loader();
}

export function knownEntities(): string[] {
	return Object.keys(ENTITIES).sort();
}
